import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '../modules/global/jwt.service';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { LoggerService } from '../modules/global/logger.service';
import { UserRole } from '../enums/userRole.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class TokenRolesGuard implements CanActivate {
  private readonly logger = LoggerService.forRoot(TokenRolesGuard.name);

  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler?.();
    const controllerClass = context.getClass?.();
    const controllerName = controllerClass?.name || 'UnknownController';
    const handlerName = handler?.name || 'UnknownHandler';

    // Get required roles and scopes from decorators
    const requiredRoles =
      this.reflector.get<UserRole[]>(ROLES_KEY, context.getHandler()) || [];

    const requiredScopes =
      this.reflector.get<string[]>(SCOPES_KEY, context.getHandler()) || [];

    // If no roles or scopes are required, allow access
    if (requiredRoles.length === 0 && requiredScopes.length === 0) {
      this.logger.log({
        message: 'No roles or scopes required, allowing request',
        controllerName,
        handlerName,
      });
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const requestMeta = this.buildRequestLogMeta(
      request,
      controllerName,
      handlerName,
    );

    this.logger.log({
      message: 'Evaluating token roles guard',
      ...requestMeta,
      requiredRoles,
      requiredScopes,
    });

    try {
      const user = request['user'];

      if (!user && (requiredRoles.length || requiredScopes.length)) {
        this.logger.warn({
          message: 'Rejecting request due to missing user payload',
          ...requestMeta,
          hasUser: false,
        });
        throw new UnauthorizedException('Missing or invalid token!');
      }

      this.logger.log({
        message: 'User payload extracted from request',
        ...requestMeta,
        userId: user?.userId,
        isMachine: Boolean(user?.isMachine),
        roles: user?.roles,
        scopes: user?.scopes,
      });

      const normalizedRequiredRoles = requiredRoles.map((role) =>
        String(role).trim().toLowerCase(),
      );

      // Check role-based access for regular users
      if (normalizedRequiredRoles.length > 0) {
        const normalizedUserRoles = this.normalizeUserRoles(user.roles);

        this.logger.log({
          message: 'Checking role-based permissions',
          ...requestMeta,
          normalizedRequiredRoles,
          normalizedUserRoles,
        });

        const hasRole = normalizedRequiredRoles.some((role) =>
          normalizedUserRoles.includes(role),
        );
        if (hasRole) {
          this.logger.log({
            message: 'Access granted via role-based authorization',
            ...requestMeta,
            normalizedRequiredRoles,
          });
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
          this.logger.log({
            message:
              'Access granted via submission list challenge fallback rule',
            ...requestMeta,
            challengeId: request?.query?.challengeId,
            userId: user?.userId,
          });
          return true;
        }
      }

      // Check scope-based access for M2M tokens
      if (user.scopes && requiredScopes.length > 0) {
        const hasScope = requiredScopes.some((scope) =>
          user.scopes ? user.scopes.includes(scope) : false,
        );

        this.logger.log({
          message: 'Checking scope-based permissions',
          ...requestMeta,
          requiredScopes,
          tokenScopes: user.scopes,
          hasScope,
        });

        if (hasScope) {
          this.logger.log({
            message: 'Access granted via scope-based authorization',
            ...requestMeta,
          });
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
        this.logger.warn({
          message:
            'M2M token detected without role permissions for role-only endpoint',
          ...requestMeta,
          tokenScopes: user.scopes,
        });
        throw new ForbiddenException('M2M token not allowed for this endpoint');
      }

      // Access denied - neither roles nor scopes match
      this.logger.warn({
        message: 'Access denied due to insufficient permissions',
        ...requestMeta,
        requiredRoles,
        requiredScopes,
      });
      throw new ForbiddenException('Insufficient permissions');
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        {
          message: 'Unexpected error validating token roles',
          ...requestMeta,
          error:
            error instanceof Error ? error.message : String(error ?? 'error'),
        },
        error instanceof Error ? error.stack : undefined,
      );
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

  private static readonly GENERAL_USER_ROLE_ALIASES = new Set(
    [
      String(UserRole.User).trim().toLowerCase(),
      'member',
      'topcoder member',
      'topcoder user',
      'topcoder talent',
      'user',
    ].filter((role) => role.length > 0),
  );

  private normalizeUserRoles(roles: unknown): string[] {
    if (!Array.isArray(roles)) {
      return [];
    }

    const normalizedRoles = new Set<string>();

    for (const role of roles) {
      const normalizedRole = String(role ?? '')
        .trim()
        .toLowerCase();
      if (!normalizedRole) {
        continue;
      }

      normalizedRoles.add(normalizedRole);

      if (TokenRolesGuard.GENERAL_USER_ROLE_ALIASES.has(normalizedRole)) {
        for (const alias of TokenRolesGuard.GENERAL_USER_ROLE_ALIASES) {
          normalizedRoles.add(alias);
        }
      }
    }

    return Array.from(normalizedRoles);
  }

  private buildRequestLogMeta(
    request: any,
    controllerName: string,
    handlerName: string,
  ) {
    const headers = (request?.headers || {}) as Record<
      string,
      string | string[] | undefined
    >;
    const correlationIdCandidate =
      headers['x-request-id'] ||
      headers['x-correlation-id'] ||
      headers['x-trace-id'];
    const method =
      typeof request?.method === 'string'
        ? request.method.toUpperCase()
        : undefined;

    return {
      controllerName,
      handlerName,
      method,
      path: request?.originalUrl || request?.url || request?.path,
      correlationId: Array.isArray(correlationIdCandidate)
        ? correlationIdCandidate[0]
        : correlationIdCandidate,
    };
  }
}
