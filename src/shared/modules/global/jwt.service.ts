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

// tc-core-library-js is CommonJS only, import via require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tcCore = require('tc-core-library-js');

export interface JwtUser {
  userId?: string;
  handle?: string;
  roles?: UserRole[];
  scopes?: string[];
  isMachine: boolean;
}

export const isAdmin = (user: JwtUser): boolean => {
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

@Injectable()
export class JwtService implements OnModuleInit {
  private static readonly SLOW_VALIDATION_WARNING_INTERVAL_MS = 5000;
  private jwtAuthenticator: any;
  private readonly logger = LoggerService.forRoot('JwtService');

  /**
   * Initialize the tc-core-library-js JWT authenticator
   */
  onModuleInit() {
    this.logger.log('Initializing tc-core JWT authenticator');
    this.jwtAuthenticator = tcCore.middleware.jwtAuthenticator({
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
      const payload = await new Promise<any>((resolve, reject) => {
        // Create a request object with the authorization header
        const req = {
          headers: {
            authorization: token.startsWith('Bearer ')
              ? token
              : `Bearer ${token}`,
          },
        };

        const waitLogger = setInterval(() => {
          this.logger.warn({
            message: 'Awaiting tc-core jwtAuthenticator callback',
            tokenHash,
            waitedMs: Date.now() - startedAt,
            iss: tokenMetadata?.iss,
            kid: tokenMetadata?.kid,
          });
        }, JwtService.SLOW_VALIDATION_WARNING_INTERVAL_MS);

        const clearWaitLogger = () => {
          clearInterval(waitLogger);
        };

        const sendUnauthorized = (
          fallbackMessage: string,
          detail?: unknown,
          statusCode?: number,
        ) => {
          clearWaitLogger();
          const detailMessage =
            this.extractErrorMessage(detail) ?? fallbackMessage;
          this.logger.error({
            message: 'tc-core jwtAuthenticator reported unauthorized response',
            tokenHash,
            statusCode,
            detailMessage,
            detail: this.safeSerialize(detail),
          });
          return reject(new UnauthorizedException(detailMessage));
        };

        const res = {
          status: (statusCode: number) => {
            return {
              json: (body?: unknown) =>
                sendUnauthorized(
                  this.extractErrorMessage(body) ??
                    (statusCode === 403 ? 'Token expired' : 'Invalid token'),
                  body,
                  statusCode,
                ),
            };
          },
          json: (body?: unknown) =>
            sendUnauthorized(
              this.extractErrorMessage(body) ?? 'Invalid token',
              body,
            ),
          send: (...args: any[]) => {
            const statusCode =
              typeof args[0] === 'number' ? args[0] : undefined;
            return sendUnauthorized(
              this.extractErrorMessage(
                typeof statusCode === 'number' ? args[1] : args[0],
              ) ?? (statusCode === 403 ? 'Token expired' : 'Invalid token'),
              typeof statusCode === 'number' ? args[1] : args[0],
              statusCode,
            );
          },
        };

        const next = (error?: any) => {
          clearWaitLogger();
          if (error) {
            this.logger.error(
              {
                message: 'tc-core jwtAuthenticator rejected token',
                tokenHash,
                error: error instanceof Error ? error.message : String(error),
              },
              error instanceof Error ? error.stack : undefined,
            );
            return reject(new UnauthorizedException('Invalid token'));
          }

          // tc-core-library-js should have attached authUser to the request
          const authUser = (req as any).authUser;

          if (!authUser) {
            return reject(new UnauthorizedException('Invalid token'));
          }

          resolve(authUser);
        };

        // Call the tc-core-library-js authenticator
        try {
          this.logger.log({
            message: 'Invoking tc-core jwtAuthenticator',
            tokenHash,
            validIssuersPreview: validIssuers.slice(0, 5),
            validIssuersProvided: validIssuers.length,
          });
          this.jwtAuthenticator(req, res, next);
          this.logger.log({
            message:
              'tc-core jwtAuthenticator returned control, awaiting callback',
            tokenHash,
          });
        } catch (invocationError) {
          clearWaitLogger();
          this.logger.error(
            {
              message: 'tc-core jwtAuthenticator threw synchronously',
              tokenHash,
              error:
                invocationError instanceof Error
                  ? invocationError.message
                  : String(invocationError),
            },
            invocationError instanceof Error
              ? invocationError.stack
              : undefined,
          );
          return reject(new UnauthorizedException('Invalid token'));
        }
      });

      this.logger.log({
        message: 'Token decoded successfully',
        tokenHash,
        hasScopes: Boolean(payload?.scopes || payload?.scope),
      });
      const user: JwtUser = { isMachine: false };

      // Check for M2M token (has scopes)
      if (payload.scopes || payload.scope) {
        const scopeString =
          payload.scope ||
          (Array.isArray(payload.scopes)
            ? payload.scopes.join(' ')
            : payload.scopes);
        const rawScopes =
          typeof scopeString === 'string'
            ? scopeString.split(' ')
            : scopeString;
        user.scopes = this.expandScopes(rawScopes);
        user.userId = payload.sub || payload.userId;
        user.isMachine = true;
      } else {
        // User token - extract roles, userId and handle
        user.userId = payload.userId || payload.sub;
        user.handle = payload.handle;
        user.roles = payload.roles || [];

        // Check for roles, userId and handle in custom claims
        for (const key of Object.keys(payload)) {
          if (key.endsWith('handle')) {
            user.handle = payload[key] as string;
          }
          if (key.endsWith('userId')) {
            user.userId = payload[key] as string;
          }
          if (key.endsWith('roles')) {
            user.roles = payload[key] as UserRole[];
          }
        }
      }

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
