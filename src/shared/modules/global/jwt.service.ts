import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { ALL_SCOPE_MAPPINGS } from '../../enums/scopes.enum';
import { UserRole } from '../../enums/userRole.enum';
import { AuthConfig } from '../../config/auth.config';
import { LoggerService } from './logger.service';

import { createJwtVerifier, type JwtVerifier } from 'tc-core-library-js';

export interface JwtUser {
  userId?: string;
  handle?: string;
  roles?: UserRole[];
  scopes?: string[];
  isMachine: boolean;
}

/**
 * Reports whether a caller has administrator authority.
 *
 * Machine tokens are treated as administrators. The parameter accepts
 * null/undefined so anonymous callers - which public routes such as the
 * Marathon Match leaderboard now allow - can be tested without a guard at
 * every call site.
 *
 * @param user authenticated caller, or null/undefined for an anonymous request.
 * @returns true for machine tokens and users holding an administrator role.
 * @throws Does not throw.
 */
export const isAdmin = (user: JwtUser | null | undefined): boolean => {
  if (!user) {
    return false;
  }

  if (user.isMachine) {
    return true;
  }

  if (!Array.isArray(user.roles)) {
    return false;
  }

  const normalizedRoles = user.roles
    .map((role) => String(role).trim().toLowerCase())
    .filter((role) => role.length > 0);

  const adminRole = String(UserRole.Admin).trim().toLowerCase();

  return normalizedRoles.includes(adminRole);
};

export const isTalentManager = (user: JwtUser): boolean => {
  if (!user || !Array.isArray(user.roles)) {
    return false;
  }

  const normalizedRoles = user.roles
    .map((role) => String(role).trim().toLowerCase())
    .filter((role) => role.length > 0);

  const tmRole = String(UserRole.TalentManager).trim().toLowerCase();

  return normalizedRoles.includes(tmRole);
};

@Injectable()
export class JwtService implements OnModuleInit {
    private verifier?: JwtVerifier;
  private readonly logger = LoggerService.forRoot('JwtService');

  /**
   * Initialize the shared verifier; returns void and throws for invalid JWT configuration.
   */
  onModuleInit() {
    this.logger.log('Initializing tc-core JWT authenticator');
    this.verifier = createJwtVerifier({
      AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE || AuthConfig.jwt.audience,
      AUTH_SECRET: AuthConfig.authSecret,
      VALID_ISSUERS: AuthConfig.validIssuers,
    });
    this.logger.log('JWT authenticator initialized');
  }

  /**
   * Validates and extracts user information from a JWT token
   * @param token The JWT token to validate
   * @returns The user information extracted from the token
   */
  async validateToken(token: string): Promise<JwtUser> {
    const startedAt = Date.now();
    const tokenHash = this.anonymizeToken(token);
    const tokenMetadata = this.decodeTokenMetadata(token);
    const validIssuers = this.getValidIssuersList();
    const hasAuthSecret = Boolean(AuthConfig.authSecret);
    this.logger.log({
      message: 'Starting JWT validation',
      tokenHash,
      hasAuthSecret,
      validIssuerCount: validIssuers.length,
      validIssuersSourceType: Array.isArray(AuthConfig.validIssuers)
        ? 'array'
        : typeof AuthConfig.validIssuers,
      alg: tokenMetadata?.alg,
      kid: tokenMetadata?.kid,
      iss: tokenMetadata?.iss,
      aud: tokenMetadata?.aud,
      sub: tokenMetadata?.sub,
    });
    try {
      // Use tc-core-library-js for JWT validation
      if (!this.verifier) throw new Error('JWT verifier is not initialized');
      const payload = await this.verifier.verify(token.replace(/^Bearer /i, ''));

      this.logger.log({
        message: 'Token decoded successfully',
        tokenHash,
        hasScopes: Boolean(payload?.scopes || payload?.scope),
      });
      const id = payload.userId ?? payload.sub;
      const user: JwtUser = {
        userId: id === undefined ? undefined : String(id),
        handle: payload.handle,
        roles: payload.roles as UserRole[],
        scopes: this.expandScopes(payload.scopes),
        isMachine: payload.isMachine,
      };

      this.logger.log({
        message: 'JWT validation completed',
        tokenHash,
        userId: user.userId,
        isMachine: user.isMachine,
        hasRoles: Array.isArray(user.roles),
        hasScopes: Array.isArray(user.scopes) && user.scopes.length > 0,
        durationMs: Date.now() - startedAt,
      });
      return user;
    } catch (error) {
      this.logger.error(
        {
          message: 'Token validation failed',
          tokenHash,
          error: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
      );
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Expands all "all:*" scopes into their individual scopes
   * @param scopes The list of scopes to expand
   * @returns The expanded list of scopes
   */
  private expandScopes(scopes: string[]): string[] {
    const expandedScopes = new Set<string>();

    // Add all original scopes
    scopes.forEach((scope) => expandedScopes.add(scope));

    // Expand all "all:*" scopes
    scopes.forEach((scope) => {
      if (ALL_SCOPE_MAPPINGS[scope]) {
        ALL_SCOPE_MAPPINGS[scope].forEach((s) => expandedScopes.add(s));
      }
    });

    return Array.from(expandedScopes);
  }

  private anonymizeToken(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 16);
  }

  private safeSerialize(value: unknown): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }

  private extractErrorMessage(body: unknown): string | undefined {
    if (!body) {
      return undefined;
    }
    if (typeof body === 'string' && body.trim().length > 0) {
      return body;
    }
    if (typeof body === 'object') {
      const container = body as Record<string, unknown>;
      const directMessage = container.message;
      if (
        typeof directMessage === 'string' &&
        directMessage.trim().length > 0
      ) {
        return directMessage;
      }

      const result = container.result;
      if (result && typeof result === 'object') {
        const content = (result as Record<string, unknown>).content;
        if (content && typeof content === 'object') {
          const nestedMessage = (content as Record<string, unknown>).message;
          if (
            typeof nestedMessage === 'string' &&
            nestedMessage.trim().length > 0
          ) {
            return nestedMessage;
          }
        }
      }
    }
    return undefined;
  }

  private decodeTokenMetadata(token: string):
    | {
        alg?: string;
        kid?: string;
        iss?: string;
        sub?: string;
        aud?: string;
      }
    | undefined {
    try {
      const decodedRaw = jwt.decode(token, { complete: true });
      const decoded = decodedRaw as
        | (jwt.Jwt & {
            payload?: Record<string, unknown> | string;
          })
        | null;

      if (!decoded || typeof decoded !== 'object') {
        return undefined;
      }

      const header = decoded.header || {};
      const payload =
        typeof decoded.payload === 'object' && decoded.payload !== null
          ? decoded.payload
          : {};

      const alg = typeof header['alg'] === 'string' ? header['alg'] : undefined;
      const kid = typeof header['kid'] === 'string' ? header['kid'] : undefined;

      const iss =
        typeof payload['iss'] === 'string' && payload['iss'].length > 0
          ? payload['iss']
          : undefined;

      const sub =
        typeof payload['sub'] === 'string' && payload['sub'].length > 0
          ? payload['sub']
          : typeof payload['userId'] === 'string' &&
              payload['userId'].length > 0
            ? payload['userId']
            : undefined;

      const audienceRaw = payload['aud'];
      const aud = Array.isArray(audienceRaw)
        ? audienceRaw
            .filter((entry): entry is string => typeof entry === 'string')
            .join(',')
        : typeof audienceRaw === 'string'
          ? audienceRaw
          : undefined;

      return { alg, kid, iss, sub, aud };
    } catch {
      return undefined;
    }
  }

  private getValidIssuersList(): string[] {
    const raw = AuthConfig.validIssuers;
    if (!raw) {
      return [];
    }

    const normalize = (issuer?: unknown) =>
      typeof issuer === 'string' ? issuer.trim() : '';

    if (Array.isArray(raw)) {
      return raw.map(normalize).filter((issuer) => issuer.length > 0);
    }

    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map(normalize).filter((issuer) => issuer.length > 0);
        }
      } catch {
        const splitIssuers = raw
          .split(',')
          .map((issuer) => issuer.trim())
          .filter((issuer) => issuer.length > 0);
        if (splitIssuers.length > 0) {
          return splitIssuers;
        }
      }
      const singleIssuer = raw.trim();
      return singleIssuer.length > 0 ? [singleIssuer] : [];
    }

    return [];
  }
}
