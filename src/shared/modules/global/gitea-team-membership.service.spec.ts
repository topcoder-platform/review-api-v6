import { GiteaTeamMembershipService } from './gitea-team-membership.service';

describe('GiteaTeamMembershipService', () => {
  const member = { memberHandle: 'tc-handle', memberId: '12345' };

  let giteaService: {
    getUser: jest.Mock;
    ensureUser: jest.Mock;
    addTeamMember: jest.Mock;
    removeTeamMember: jest.Mock;
  };
  let challengeApiService: { getChallengeDetail: jest.Mock };
  let memberService: { getUserEmails: jest.Mock };
  let service: GiteaTeamMembershipService;

  const withMetadata = (metadata: Record<string, string | null> | undefined) =>
    challengeApiService.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      metadata,
    });

  beforeEach(() => {
    giteaService = {
      addTeamMember: jest.fn().mockResolvedValue(undefined),
      ensureUser: jest.fn().mockResolvedValue({ id: 7 }),
      getUser: jest.fn().mockResolvedValue({ id: 7 }),
      removeTeamMember: jest.fn().mockResolvedValue(undefined),
    };
    challengeApiService = { getChallengeDetail: jest.fn() };
    memberService = {
      getUserEmails: jest
        .fn()
        .mockResolvedValue([
          { email: 'member@example.com', handle: 'tc-handle', userId: '12345' },
        ]),
    };
    service = new GiteaTeamMembershipService(
      giteaService as any,
      challengeApiService as any,
      memberService as any,
    );
  });

  it('adds the member to every configured team, deduplicating ids', async () => {
    withMetadata({
      gitea:
        '{"teams":[{"id":11,"name":"my-team"},{"id":22,"name":"other-team"},{"id":11,"name":"my-team"}]}',
    });

    const results = await service.addMemberToChallengeTeams(
      'challenge-1',
      member,
    );

    expect(giteaService.addTeamMember.mock.calls).toEqual([
      [11, 'tc-handle'],
      [22, 'tc-handle'],
    ]);
    expect(results).toEqual([
      { succeeded: true, teamId: 11, teamName: 'my-team' },
      { succeeded: true, teamId: 22, teamName: 'other-team' },
    ]);
  });

  it('removes the member from every configured team', async () => {
    withMetadata({
      gitea: '{"teams":[{"id":11,"name":"my-team"},{"id":22}]}',
    });

    await service.removeMemberFromChallengeTeams('challenge-1', member);

    expect(giteaService.removeTeamMember.mock.calls).toEqual([
      [11, 'tc-handle'],
      [22, 'tc-handle'],
    ]);
    expect(giteaService.getUser).not.toHaveBeenCalled();
  });

  it('keeps going when a single team fails', async () => {
    withMetadata({
      gitea: '{"teams":[{"id":11,"name":"my-team"},{"id":22}]}',
    });
    giteaService.addTeamMember.mockImplementation((teamId: number) =>
      teamId === 11
        ? Promise.reject(
            Object.assign(new Error('not found'), {
              response: { status: 404 },
            }),
          )
        : Promise.resolve(undefined),
    );

    const results = await service.addMemberToChallengeTeams(
      'challenge-1',
      member,
    );

    expect(results).toEqual([
      {
        error: 'status 404: not found',
        succeeded: false,
        teamId: 11,
        teamName: 'my-team',
      },
      { succeeded: true, teamId: 22, teamName: undefined },
    ]);
  });

  it('accepts bare ids and skips entries without a usable numeric id', async () => {
    withMetadata({
      gitea:
        '{"teams":[{"id":11,"name":"my-team"},{"name":"no-id"},"my-team","",0,-3,"7.5"," 42 ",13]}',
    });

    await service.addMemberToChallengeTeams('challenge-1', member);

    expect(giteaService.addTeamMember.mock.calls).toEqual([
      [11, 'tc-handle'],
      [42, 'tc-handle'],
      [13, 'tc-handle'],
    ]);
  });

  it.each([
    ['no metadata at all', undefined],
    ['no gitea key', { other: 'value' }],
    ['empty gitea value', { gitea: '' }],
    ['unparseable gitea value', { gitea: 'not json' }],
    ['gitea value without teams array', { gitea: '{"teams":"my-team"}' }],
    [
      'gitea value with no addressable team',
      { gitea: '{"teams":["my-team"]}' },
    ],
  ])('performs no Gitea calls when there is %s', async (_label, metadata) => {
    withMetadata(metadata as Record<string, string | null> | undefined);

    const results = await service.addMemberToChallengeTeams(
      'challenge-1',
      member,
    );

    expect(results).toEqual([]);
    expect(giteaService.getUser).not.toHaveBeenCalled();
    expect(giteaService.addTeamMember).not.toHaveBeenCalled();
  });

  it('provisions a Gitea account when the handle is unknown', async () => {
    withMetadata({ gitea: '{"teams":[{"id":11,"name":"my-team"}]}' });
    giteaService.getUser.mockResolvedValue(null);

    await service.addMemberToChallengeTeams('challenge-1', member);

    expect(memberService.getUserEmails).toHaveBeenCalledWith(['12345']);
    expect(giteaService.ensureUser).toHaveBeenCalledWith({
      email: 'member@example.com',
      handle: 'tc-handle',
      userId: '12345',
    });
    expect(giteaService.addTeamMember).toHaveBeenCalledWith(11, 'tc-handle');
  });

  it('does not attempt team membership when provisioning fails', async () => {
    withMetadata({ gitea: '{"teams":[{"id":11,"name":"my-team"}]}' });
    giteaService.getUser.mockResolvedValue(null);
    memberService.getUserEmails.mockResolvedValue([]);

    const results = await service.addMemberToChallengeTeams(
      'challenge-1',
      member,
    );

    expect(results).toEqual([]);
    expect(giteaService.ensureUser).not.toHaveBeenCalled();
    expect(giteaService.addTeamMember).not.toHaveBeenCalled();
  });

  it('returns no results when the challenge lookup fails', async () => {
    challengeApiService.getChallengeDetail.mockRejectedValue(
      new Error('challenge api down'),
    );

    const results = await service.addMemberToChallengeTeams(
      'challenge-1',
      member,
    );

    expect(results).toEqual([]);
    expect(giteaService.addTeamMember).not.toHaveBeenCalled();
  });
});
