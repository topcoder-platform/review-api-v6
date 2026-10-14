jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import 'reflect-metadata';

import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY, TokenRolesGuard } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { AiReviewTemplateController } from './ai-review-template.controller';

describe('AiReviewTemplateController', () => {
  const guard = new TokenRolesGuard(new Reflector(), {} as any);
  const findAllHandler = Object.getOwnPropertyDescriptor(
    AiReviewTemplateController.prototype,
    'findAll',
  )?.value as object;

  /**
   * Builds an execution context that routes a GET request for the given user
   * roles to `AiReviewTemplateController.findAll`.
   *
   * @param roles JWT roles carried by the caller.
   * @returns execution context consumed by TokenRolesGuard.canActivate.
   */
  const createFindAllContext = (roles: string[]): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          query: {},
          user: { userId: '88778352', isMachine: false, roles },
        }),
      }),
      getHandler: () => findAllHandler,
      getClass: () => AiReviewTemplateController,
    }) as unknown as ExecutionContext;

  it('allows Project Managers to list AI review templates', () => {
    expect(Reflect.getMetadata(ROLES_KEY, findAllHandler)).toEqual(
      expect.arrayContaining([UserRole.ProjectManager]),
    );
    expect(
      guard.canActivate(
        createFindAllContext([UserRole.ProjectManager, UserRole.User]),
      ),
    ).toBe(true);
  });

  it('still rejects plain members from listing AI review templates', () => {
    expect(() =>
      guard.canActivate(createFindAllContext([UserRole.User])),
    ).toThrow(ForbiddenException);
  });
});
