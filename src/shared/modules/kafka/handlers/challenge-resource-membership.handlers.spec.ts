import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeResourceCreateHandler } from './challenge-resource-create.handler';
import { ChallengeResourceDeleteHandler } from './challenge-resource-delete.handler';

describe('challenge resource Gitea membership handlers', () => {
  const submitterPayload = {
    challengeId: 'challenge-1',
    id: 'resource-1',
    memberHandle: 'tc-handle',
    memberId: 12345,
    roleId: CommonConfig.roles.submitterRoleId,
  };

  let handlerRegistry: { registerHandler: jest.Mock };
  let membershipService: {
    addMemberToChallengeTeams: jest.Mock;
    removeMemberFromChallengeTeams: jest.Mock;
  };
  let createHandler: ChallengeResourceCreateHandler;
  let deleteHandler: ChallengeResourceDeleteHandler;

  beforeEach(() => {
    handlerRegistry = { registerHandler: jest.fn() };
    membershipService = {
      addMemberToChallengeTeams: jest.fn().mockResolvedValue([]),
      removeMemberFromChallengeTeams: jest.fn().mockResolvedValue([]),
    };
    createHandler = new ChallengeResourceCreateHandler(
      handlerRegistry as any,
      membershipService as any,
    );
    deleteHandler = new ChallengeResourceDeleteHandler(
      handlerRegistry as any,
      membershipService as any,
    );
  });

  it('registers the resource create and delete topics', () => {
    createHandler.onModuleInit();
    deleteHandler.onModuleInit();

    expect(createHandler.getTopic()).toBe('challenge.action.resource.create');
    expect(deleteHandler.getTopic()).toBe('challenge.action.resource.delete');
    expect(handlerRegistry.registerHandler.mock.calls).toEqual([
      ['challenge.action.resource.create', createHandler],
      ['challenge.action.resource.delete', deleteHandler],
    ]);
  });

  it('adds submitters to the configured Gitea teams on registration', async () => {
    await createHandler.handle({ payload: submitterPayload });

    expect(membershipService.addMemberToChallengeTeams).toHaveBeenCalledWith(
      'challenge-1',
      { memberHandle: 'tc-handle', memberId: '12345' },
    );
  });

  it('removes submitters from the configured Gitea teams on unregistration', async () => {
    await deleteHandler.handle({ payload: submitterPayload });

    expect(
      membershipService.removeMemberFromChallengeTeams,
    ).toHaveBeenCalledWith('challenge-1', {
      memberHandle: 'tc-handle',
      memberId: '12345',
    });
  });

  it.each([
    ['a non-submitter role', { ...submitterPayload, roleId: 'copilot-role' }],
    ['a missing challenge id', { ...submitterPayload, challengeId: '' }],
    ['a missing member handle', { ...submitterPayload, memberHandle: '  ' }],
    ['a missing member id', { ...submitterPayload, memberId: undefined }],
  ])('ignores events with %s', async (_label, payload) => {
    await createHandler.handle({ payload });

    expect(membershipService.addMemberToChallengeTeams).not.toHaveBeenCalled();
  });

  it.each([
    ['a null message', null],
    ['an envelope without payload', {}],
  ])('ignores %s', async (_label, message) => {
    await createHandler.handle(message);

    expect(membershipService.addMemberToChallengeTeams).not.toHaveBeenCalled();
  });

  it('swallows membership sync failures so the message is not retried', async () => {
    membershipService.addMemberToChallengeTeams.mockRejectedValue(
      new Error('gitea unreachable'),
    );

    await expect(
      createHandler.handle({ payload: submitterPayload }),
    ).resolves.toBeUndefined();
  });
});
