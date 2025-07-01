import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { decode, verify, VerifyOptions, Secret } from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';
import { ALL_SCOPE_MAPPINGS, Scope } from '../../enums/scopes.enum';
import { UserRole } from '../../enums/userRole.enum';
import { AuthConfig } from '../../config/auth.config';

export interface JwtUser {
  userId?: string;
  handle?: string;
  roles?: UserRole[];
  scopes?: string[];
  isMachine: boolean;
}

export const isAdmin = (user: JwtUser): boolean => {
  return user.isMachine || (user.roles ?? []).includes(UserRole.Admin);
}

// Map for testing tokens, will be removed in production
const TOKEN_ROLE_MAP: Record<string, string[]> = {
  'admin-token': [UserRole.Admin],
  'copilot-token': [UserRole.Copilot],
  'reviewer-token': [UserRole.Reviewer],
  'submitter-token': [UserRole.Submitter],
};

// For testing m2m tokens
const TEST_M2M_TOKENS: Record<string, string[]> = {
  'm2m-token-all': [
    Scope.AllAppeal,
    Scope.AllContactRequest,
    Scope.AllProjectResult,
    Scope.AllReview,
    Scope.AllScorecard,
  ],
  'm2m-token-review': [Scope.AllReview],
  'm2m-token-scorecard': [Scope.AllScorecard],
  'm2m-token-appeal': [Scope.AllAppeal],
  'm2m-token-contact-request': [Scope.AllContactRequest],
  'm2m-token-project-result': [Scope.AllProjectResult],
};

@Injectable()
export class JwtService implements OnModuleInit {
  private jwksClientInstance: jwksClient.JwksClient;

  /**
   * Initialize the JWKS client
   */
  onModuleInit() {
    this.jwksClientInstance = jwksClient({
      jwksUri: `${AuthConfig.jwt.issuer.replace(/\/$/, '')}/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
    });
  }

  /**
   * Validates and extracts user information from a JWT token
   * @param token The JWT token to validate
   * @returns The user information extracted from the token
   */
  async validateToken(token: string): Promise<JwtUser> {
    try {
      // First check if it's a test token
      if (TOKEN_ROLE_MAP[token]) {
        return { roles: TOKEN_ROLE_MAP[token] as UserRole[], isMachine: false };
      }

      // Check if it's a test M2M token
      if (TEST_M2M_TOKENS[token]) {
        const rawScopes = TEST_M2M_TOKENS[token];
        const scopes = this.expandScopes(rawScopes);
        return { scopes, isMachine: false };
      }

      let decodedToken: any;

      // In production, we verify the token
      if (process.env.NODE_ENV === 'production') {
        try {
          // First decode the token to get the kid (Key ID)
          const tokenHeader = decode(token, { complete: true })?.header;

          if (!tokenHeader || !tokenHeader.kid) {
            throw new UnauthorizedException('Invalid token: Missing key ID');
          }

          // Get the signing key from Auth0
          const signingKey = await this.getSigningKey(tokenHeader.kid);

          // Verify options
          const verifyOptions: VerifyOptions = {
            issuer: AuthConfig.jwt.issuer,
            audience: AuthConfig.jwt.audience,
            clockTolerance: AuthConfig.jwt.clockTolerance,
            ignoreExpiration: AuthConfig.jwt.ignoreExpiration,
          };

          // Verify the token
          decodedToken = verify(token, signingKey, verifyOptions);
        } catch (error) {
          console.error('JWT verification failed:', error);
          throw new UnauthorizedException('Invalid token');
        }
      } else {
        // In development, just decode the token without verification
        decodedToken = decode(token);
      }

      if (!decodedToken) {
        throw new UnauthorizedException('Invalid token');
      }

      const user: JwtUser = {isMachine: false};

      // Check for M2M token from Auth0
      if (decodedToken.scope) {
        const scopeString = decodedToken.scope as string;
        const rawScopes = scopeString.split(' ');
        user.scopes = this.expandScopes(rawScopes);
        user.userId = decodedToken.sub;
        user.isMachine = true;
      } else {
        // Check for roles, userId and handle in a user token
        for (const key of Object.keys(decodedToken)) {
          if (key.endsWith('handle')) {
            user.handle = decodedToken[key] as string;
          }
          if (key.endsWith('userId')) {
            user.userId = decodedToken[key] as string;
          }
          if (key.endsWith('roles')) {
            user.roles = decodedToken[key] as UserRole[]
          }
        }
      }
      return user;
    } catch (error) {
      console.error('Token validation failed:', error);
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Gets the signing key from Auth0
   * @param kid The Key ID from the JWT header
   * @returns A Promise that resolves to the signing key
   */
  private getSigningKey(kid: string): Promise<Secret> {
    return new Promise((resolve, reject) => {
      this.jwksClientInstance.getSigningKey(kid, (err, key) => {
        if (err || !key) {
          console.error('Error getting signing key:', err);
          return reject(
            new UnauthorizedException(
              'Invalid token: Unable to get signing key',
            ),
          );
        }

        // Get the public key using the proper method
        const signingKey = key.getPublicKey();

        if (!signingKey) {
          return reject(
            new UnauthorizedException(
              'Invalid token: Unable to get public key',
            ),
          );
        }

        resolve(signingKey);
      });
    });
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
}
