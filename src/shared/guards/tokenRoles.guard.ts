import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export enum UserRole {
  Admin = 'Admin',
  Copilot = 'Copilot',
  Reviewer = 'Reviewer',
  Submitter = 'Submitter',
}

// Hardcoded tokens and their associated roles (for testing)
const TOKEN_ROLE_MAP: Record<string, string[]> = {
  'admin-token': [UserRole.Admin],
  'copilot-token': [UserRole.Copilot],
  'reviewer-token': [UserRole.Reviewer],
  'submitter-token': [UserRole.Submitter],
};

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class TokenRolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No roles required, allow access
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Invalid or missing token');
    }

    try {
      const token = authHeader.split(' ')[1];
      const userRoles = TOKEN_ROLE_MAP[token] || [];
      if (requiredRoles.some((role) => userRoles.includes(role))) {
        return true; // User has at least one required role
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
    throw new ForbiddenException('Insufficient permissions');
  }
}
