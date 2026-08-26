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
    withMetadata({ gitea: '{"teams":["my-team","other.team_1","my-team"]}' });

    const results = await service.addMemberToChallengeTeams(
      'challenge-1',
      member,
    );

    expect(giteaService.addTeamMember.mock.calls).toEqual([
      ['my-team', 'tc-handle'],
      ['other.team_1', 'tc-handle'],
    ]);
    expect(results).toEqual([
      { succeeded: true, teamId: 'my-team' },
      { succeeded: true, teamId: 'other.team_1' },
    ]);
  });

  it('removes the member from every configured team', async () => {
    withMetadata({ gitea: '{"teams":["my-team","other-team"]}' });

    await service.removeMemberFromChallengeTeams('challenge-1', member);

    expect(giteaService.removeTeamMember.mock.calls).toEqual([
      ['my-team', 'tc-handle'],
      ['other-team', 'tc-handle'],
    ]);
    expect(giteaService.getUser).not.toHaveBeenCalled();
  });

  it('keeps going when a single team fails', async () => {
    withMetadata({ gitea: '{"teams":["my-team","other-team"]}' });
    giteaService.addTeamMember.mockImplementation((teamId: string) =>
      teamId === 'my-team'
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
      { error: 'status 404: not found', succeeded: false, teamId: 'my-team' },
      { succeeded: true, teamId: 'other-team' },
    ]);
  });

  it('skips team ids with characters Gitea cannot address', async () => {
    withMetadata({
      gitea:
        '{"teams":["my-team","has space","has/slash","",42," other.team_1 "]}',
    });

    await service.addMemberToChallengeTeams('challenge-1', member);

    expect(giteaService.addTeamMember.mock.calls).toEqual([
      ['my-team', 'tc-handle'],
      ['42', 'tc-handle'],
      ['other.team_1', 'tc-handle'],
    ]);
  });

  it.each([
    ['no metadata at all', undefined],
    ['no gitea key', { other: 'value' }],
    ['empty gitea value', { gitea: '' }],
    ['unparseable gitea value', { gitea: 'not json' }],
    ['gitea value without teams array', { gitea: '{"teams":"my-team"}' }],
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
    withMetadata({ gitea: '{"teams":["my-team"]}' });
    giteaService.getUser.mockResolvedValue(null);

    await service.addMemberToChallengeTeams('challenge-1', member);

    expect(memberService.getUserEmails).toHaveBeenCalledWith(['12345']);
    expect(giteaService.ensureUser).toHaveBeenCalledWith({
      email: 'member@example.com',
      handle: 'tc-handle',
      userId: '12345',
    });
    expect(giteaService.addTeamMember).toHaveBeenCalledWith(
      'my-team',
      'tc-handle',
    );
  });

  it('does not attempt team membership when provisioning fails', async () => {
    withMetadata({ gitea: '{"teams":["my-team"]}' });
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
