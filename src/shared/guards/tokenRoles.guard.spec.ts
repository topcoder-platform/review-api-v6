import 'reflect-metadata';

import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { TokenRolesGuard, ROLES_KEY } from './tokenRoles.guard';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { UserRole } from '../enums/userRole.enum';

describe('TokenRolesGuard', () => {
  const reflector = new Reflector();
  const guard = new TokenRolesGuard(reflector, {} as any);

  function listSubmissions() {
    return undefined;
  }

  const handler = listSubmissions;

  type TestRequest = Record<string, unknown> & {
    method: string;
    query: Record<string, unknown>;
    user?: {
      userId: string;
      isMachine: boolean;
      roles?: unknown[];
      scopes?: unknown[];
    };
  };

  const createExecutionContext = (request: TestRequest): ExecutionContext => {
    class SubmissionController {}

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => handler,
      getClass: () => SubmissionController,
      getType: () => 'http',
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({
        getData: () => undefined,
        getContext: () => undefined,
      }),
      switchToWs: () => ({
        getClient: () => undefined,
        getData: () => undefined,
        getPattern: () => undefined,
      }),
    } as unknown as ExecutionContext;
  };

  describe('general user role aliases', () => {
    beforeEach(() => {
      Reflect.defineMetadata(ROLES_KEY, [UserRole.User], handler);
      Reflect.defineMetadata(SCOPES_KEY, [], handler);
    });

    it('allows Member role to satisfy general user access', () => {
      const request = {
        method: 'GET',
        query: {},
        user: {
          userId: '1001',
          isMachine: false,
          roles: ['Member'],
        },
      };

      const context = createExecutionContext(request);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows Topcoder Member role to satisfy general user access', () => {
      const request = {
        method: 'GET',
        query: {},
        user: {
          userId: '1001',
          isMachine: false,
          roles: ['Topcoder Member'],
        },
      };

      const context = createExecutionContext(request);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('submission list challenge fallback', () => {
    beforeEach(() => {
      Reflect.defineMetadata(
        ROLES_KEY,
        [UserRole.Copilot, UserRole.Admin, UserRole.Reviewer, UserRole.User],
        handler,
      );
      Reflect.defineMetadata(SCOPES_KEY, ['read:submission'], handler);
    });

    it('allows authenticated users without explicit roles when requesting submissions by challengeId', () => {
      const request = {
        method: 'GET',
        query: { challengeId: '12345' },
        user: {
          userId: '1001',
          isMachine: false,
          roles: [],
        },
      };

      const context = createExecutionContext(request);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('denies access when challengeId is missing', () => {
      const request = {
        method: 'GET',
        query: {},
        user: {
          userId: '1001',
          isMachine: false,
          roles: [],
        },
      };

      const context = createExecutionContext(request);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows anonymous access when challengeId is provided', () => {
      const request = {
        method: 'GET',
        query: { challengeId: '12345' },
      };

      const context = createExecutionContext(request as TestRequest);

      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
