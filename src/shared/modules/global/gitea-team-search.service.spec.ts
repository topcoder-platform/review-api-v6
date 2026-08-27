import { GiteaTeamSearchService } from './gitea-team-search.service';

describe('GiteaTeamSearchService', () => {
  const requester = { handle: 'tc-handle', isMachine: false, userId: '12345' };
  const match = {
    id: 11,
    name: 'reviewers',
    organization: 'topcoder',
    description: undefined,
  };

  let giteaService: {
    getUser: jest.Mock;
    findUserByEmail: jest.Mock;
    listUserOrganizations: jest.Mock;
    searchTeams: jest.Mock;
  };
  let memberService: { getUserEmails: jest.Mock };
  let service: GiteaTeamSearchService;

  beforeEach(() => {
    giteaService = {
      findUserByEmail: jest.fn().mockResolvedValue(null),
      getUser: jest.fn().mockResolvedValue({ id: 7, login: 'tc-handle' }),
      listUserOrganizations: jest.fn().mockResolvedValue(['topcoder']),
      searchTeams: jest.fn().mockResolvedValue([match]),
    };
    memberService = {
      getUserEmails: jest
        .fn()
        .mockResolvedValue([
          { email: 'member@example.com', handle: 'tc-handle', userId: '12345' },
        ]),
    };
    service = new GiteaTeamSearchService(
      giteaService as any,
      memberService as any,
    );
  });

  it('searches only the organizations the caller belongs to', async () => {
    giteaService.listUserOrganizations.mockResolvedValue([
      'topcoder',
      'secret-partner',
    ]);

    const matches = await service.searchTeams(
      requester as any,
      ' reviewers ',
      20,
    );

    expect(giteaService.getUser).toHaveBeenCalledWith('tc-handle');
    expect(giteaService.listUserOrganizations).toHaveBeenCalledWith(
      'tc-handle',
    );
    expect(giteaService.searchTeams).toHaveBeenCalledWith('reviewers', 20, [
      'topcoder',
      'secret-partner',
    ]);
    expect(matches).toEqual([match]);
  });

  it('falls back to the member email when the handle is not a Gitea user', async () => {
    giteaService.getUser.mockResolvedValue(null);
    giteaService.findUserByEmail.mockResolvedValue({
      id: 7,
      login: 'gitea-login',
    });

    await service.searchTeams(requester as any, 'reviewers', 20);

    expect(memberService.getUserEmails).toHaveBeenCalledWith(['12345']);
    expect(giteaService.findUserByEmail).toHaveBeenCalledWith(
      'member@example.com',
    );
    expect(giteaService.listUserOrganizations).toHaveBeenCalledWith(
      'gitea-login',
    );
  });

  it('finds nothing when the caller has no Gitea account', async () => {
    giteaService.getUser.mockResolvedValue(null);

    expect(
      await service.searchTeams(requester as any, 'reviewers', 20),
    ).toEqual([]);
    expect(giteaService.listUserOrganizations).not.toHaveBeenCalled();
    expect(giteaService.searchTeams).not.toHaveBeenCalled();
  });

  it('finds nothing when the caller belongs to no organization', async () => {
    giteaService.listUserOrganizations.mockResolvedValue([]);

    expect(
      await service.searchTeams(requester as any, 'reviewers', 20),
    ).toEqual([]);
    expect(giteaService.searchTeams).not.toHaveBeenCalled();
  });

  it.each([
    ['no signed-in user', undefined],
    ['a machine token', { isMachine: true }],
  ])('finds nothing for %s', async (_label, caller) => {
    expect(await service.searchTeams(caller as any, 'reviewers', 20)).toEqual(
      [],
    );
    expect(giteaService.getUser).not.toHaveBeenCalled();
  });

  it('performs no lookup for a blank keyword', async () => {
    expect(await service.searchTeams(requester as any, '   ', 20)).toEqual([]);
    expect(giteaService.getUser).not.toHaveBeenCalled();
  });

  it('memoizes the organizations per caller', async () => {
    await service.searchTeams(requester as any, 'reviewers', 20);
    await service.searchTeams(requester as any, 'devs', 20);

    expect(giteaService.listUserOrganizations).toHaveBeenCalledTimes(1);
    expect(giteaService.searchTeams).toHaveBeenCalledTimes(2);
  });

  it('resolves each caller separately', async () => {
    await service.searchTeams(requester as any, 'reviewers', 20);
    await service.searchTeams(
      { handle: 'other', isMachine: false, userId: '67890' } as any,
      'reviewers',
      20,
    );

    expect(giteaService.listUserOrganizations).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the Gitea user lookup fails', 'getUser'],
    ['the organization lookup fails', 'listUserOrganizations'],
  ])('finds nothing when %s', async (_label, method) => {
    giteaService[method as 'getUser'].mockRejectedValue(
      new Error('gitea down'),
    );

    expect(
      await service.searchTeams(requester as any, 'reviewers', 20),
    ).toEqual([]);
    expect(giteaService.searchTeams).not.toHaveBeenCalled();
  });

  it('keeps serving the last known organizations when a refresh fails', async () => {
    await service.searchTeams(requester as any, 'reviewers', 20);

    (
      service as unknown as {
        organizationsCache: Map<string, { expiresAt: number }>;
      }
    ).organizationsCache.get('12345')!.expiresAt = 0;
    giteaService.getUser.mockRejectedValue(new Error('gitea down'));

    await service.searchTeams(requester as any, 'devs', 20);

    expect(giteaService.searchTeams).toHaveBeenLastCalledWith('devs', 20, [
      'topcoder',
    ]);
  });
});
