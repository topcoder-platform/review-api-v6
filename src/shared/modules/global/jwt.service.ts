import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { auth } from 'tc-core-library-js';
import { UserRole } from '../../enums/userRole.enum';

export interface JwtUser {
  kind?: 'user' | 'service';
  clientId?: string;
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

/** Checks the supplied verified caller for the talent manager role; returns a boolean without throwing. */
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

/** Adapts the common validator to legacy string member IDs; token trust and classification stay in core. */
@Injectable()
export class JwtService implements OnModuleInit {
  private validator?: ReturnType<typeof auth.createValidator>;

  /** Initializes explicit Keycloak/member configuration after startup; takes no arguments and throws for invalid settings. */
  onModuleInit(): void {
    this.validator = auth.createValidator();
  }

  /**
   * Verifies a bearer token and maps only its member ID representation for domain code.
   * @param rawToken Compact JWT or Bearer-prefixed header.
   * @returns Verified service/member identity with exact scopes and normalized roles.
   * @throws UnauthorizedException for invalid tokens or unavailable validation.
   */
  async validateToken(rawToken: string): Promise<JwtUser> {
    try {
      if (!this.validator) throw new Error('Validator unavailable');
      const token = rawToken.replace(/^Bearer /, '').trim();
      const principal = await this.validator.verify(token);
      return { ...principal,
        userId: principal.userId === undefined ? undefined : String(principal.userId),
        roles: principal.roles as UserRole[],
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
