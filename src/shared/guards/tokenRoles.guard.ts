import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '../modules/global/jwt.service';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { UserRole } from '../enums/userRole.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class TokenRolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles and scopes from decorators
    const requiredRoles =
      this.reflector.get<UserRole[]>(ROLES_KEY, context.getHandler()) || [];

    const requiredScopes =
      this.reflector.get<string[]>(SCOPES_KEY, context.getHandler()) || [];

    // If no roles or scopes are required, allow access
    if (requiredRoles.length === 0 && requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    try {
      const user = request['user'];

      if (!user && (requiredRoles.length || requiredScopes.length)) {
        throw new UnauthorizedException('Missing or invalid token!');
      }

      const normalizedRequiredRoles = requiredRoles.map((role) =>
        String(role).trim().toLowerCase(),
      );

      // Check role-based access for regular users
      if (normalizedRequiredRoles.length > 0) {
        const normalizedUserRoles = Array.isArray(user.roles)
          ? user.roles
              .map((role) => String(role).trim().toLowerCase())
              .filter((role) => role.length > 0)
          : [];

        const hasRole = normalizedRequiredRoles.some((role) =>
          normalizedUserRoles.includes(role),
        );
        if (hasRole) {
          return true;
        }

        if (
          this.allowSubmissionListByChallenge(
            context,
            request,
            normalizedRequiredRoles,
            user,
          )
        ) {
          return true;
        }
      }

      // Check scope-based access for M2M tokens
      if (user.scopes && requiredScopes.length > 0) {
        const hasScope = requiredScopes.some((scope) =>
          user.scopes ? user.scopes.includes(scope) : false,
        );
        if (hasScope) {
          return true;
        }
      }

      // If M2M token has scopes but no required scopes, and the endpoint requires
      // only roles but no scopes, deny access (M2M tokens should only access endpoints
      // that explicitly define scope requirements)
      if (
        user.scopes &&
        !user.roles &&
        requiredRoles.length > 0 &&
        requiredScopes.length === 0
      ) {
        throw new ForbiddenException('M2M token not allowed for this endpoint');
      }

      // Access denied - neither roles nor scopes match
      throw new ForbiddenException('Insufficient permissions');
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private allowSubmissionListByChallenge(
    context: ExecutionContext,
    request: any,
    normalizedRequiredRoles: string[],
    user: any,
  ): boolean {
    const generalUserRole = String(UserRole.User).trim().toLowerCase();

    if (user?.isMachine || !user?.userId) {
      return false;
    }

    if (!normalizedRequiredRoles.includes(generalUserRole)) {
      return false;
    }

    const handler = context.getHandler?.();
    const controllerClass = context.getClass?.();

    const isSubmissionListHandler =
      controllerClass?.name === 'SubmissionController' &&
      handler?.name === 'listSubmissions';

    if (!isSubmissionListHandler) {
      return false;
    }

    const method = (request?.method || '').toUpperCase();
    if (method !== 'GET') {
      return false;
    }

    const challengeId = request?.query?.challengeId;
    if (!this.hasNonEmptyQueryParam(challengeId)) {
      return false;
    }

    return true;
  }

  private hasNonEmptyQueryParam(value: unknown): boolean {
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.some((entry) => this.hasNonEmptyQueryParam(entry));
    }
    return false;
  }
}
