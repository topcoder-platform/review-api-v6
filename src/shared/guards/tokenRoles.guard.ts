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
      const user = request['user'] ?? {};

      // Check role-based access for regular users
      if (user.roles && requiredRoles.length > 0) {
        const hasRole = requiredRoles.some((role) =>
          user.roles ? user.roles.includes(role) : false,
        );
        if (hasRole) {
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
}
