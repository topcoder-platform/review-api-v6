import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ALL_SCOPE_MAPPINGS } from '../../enums/scopes.enum';
import { UserRole } from '../../enums/userRole.enum';
import { AuthConfig } from '../../config/auth.config';

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
  return user.isMachine || (user.roles ?? []).includes(UserRole.Admin);
};

@Injectable()
export class JwtService implements OnModuleInit {
  private jwtAuthenticator: any;

  /**
   * Initialize the tc-core-library-js JWT authenticator
   */
  onModuleInit() {
    this.jwtAuthenticator = tcCore.middleware.jwtAuthenticator({
      AUTH_SECRET: AuthConfig.authSecret,
      VALID_ISSUERS: AuthConfig.validIssuers,
    });
  }

  /**
   * Validates and extracts user information from a JWT token
   * @param token The JWT token to validate
   * @returns The user information extracted from the token
   */
  async validateToken(token: string): Promise<JwtUser> {
    try {
      // Use tc-core-library-js for JWT validation
      const payload = await new Promise<any>((resolve, reject) => {
        // Create a mock request object with the authorization header
        const mockReq = {
          headers: {
            authorization: token.startsWith('Bearer ')
              ? token
              : `Bearer ${token}`,
          },
        };

        const mockRes = {
          status: (number: number) => {
            if (number === 403) {
              return reject(new UnauthorizedException('Token expired'));
            }
            return {
              json: () => {},
            };
          },
          send: () => {},
        };

        const next = (error?: any) => {
          if (error) {
            console.error('JWT validation failed:', error);
            return reject(new UnauthorizedException('Invalid token'));
          }

          // tc-core-library-js should have attached authUser to the request
          const authUser = (mockReq as any).authUser;

          if (!authUser) {
            return reject(new UnauthorizedException('Invalid token'));
          }

          resolve(authUser);
        };

        // Call the tc-core-library-js authenticator
        this.jwtAuthenticator(mockReq, mockRes, next);
      });

      console.log(`Decoded token: ${JSON.stringify(payload)}`);
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

      return user;
    } catch (error) {
      console.error('Token validation failed:', error);
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
}
