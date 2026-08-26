import { GiteaService } from './gitea.service';

describe('GiteaService.searchTeams', () => {
  const team = (id: number, name: string, description?: string) => ({
    id,
    name,
    description,
  });

  let adminGetAllOrgs: jest.Mock;
  let teamSearch: jest.Mock;
  let service: GiteaService;

  const withOrgs = (...orgs: string[]) =>
    adminGetAllOrgs.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve({
        data: page === 1 ? orgs.map((name) => ({ name })) : [],
      }),
    );

  beforeEach(() => {
    adminGetAllOrgs = jest.fn();
    teamSearch = jest.fn().mockResolvedValue({ data: { data: [] } });
    service = new GiteaService();
    (service as unknown as { giteaClient: unknown }).giteaClient = {
      admin: { adminGetAllOrgs },
      orgs: { teamSearch },
    };
  });

  it('searches every organization and qualifies each match with its org', async () => {
    withOrgs('topcoder', 'partner');
    teamSearch.mockImplementation((org: string) =>
      Promise.resolve({
        data: {
          data:
            org === 'topcoder'
              ? [team(11, 'reviewers', 'TC reviewers')]
              : [team(22, 'reviewers-eu')],
        },
      }),
    );

    const matches = await service.searchTeams('reviewers', 20);

    expect((teamSearch.mock.calls as [string][]).map(([org]) => org)).toEqual([
      'topcoder',
      'partner',
    ]);
    expect(matches).toEqual([
      {
        id: 11,
        name: 'reviewers',
        organization: 'topcoder',
        description: 'TC reviewers',
      },
      {
        id: 22,
        name: 'reviewers-eu',
        organization: 'partner',
        description: undefined,
      },
    ]);
  });

  it('puts exact name matches first regardless of organization order', async () => {
    withOrgs('a-org', 'b-org');
    teamSearch.mockImplementation((org: string) =>
      Promise.resolve({
        data: {
          data:
            org === 'a-org'
              ? [team(1, 'devs-extra')]
              : [team(2, 'DEVS'), team(3, 'devs-more')],
        },
      }),
    );

    const matches = await service.searchTeams('devs', 20);

    expect(matches.map((match) => match.id)).toEqual([2, 1, 3]);
  });

  it('keeps matches from the other organizations when one search fails', async () => {
    withOrgs('broken', 'healthy');
    teamSearch.mockImplementation((org: string) =>
      org === 'broken'
        ? Promise.reject(
            Object.assign(new Error('forbidden'), {
              response: { status: 403 },
            }),
          )
        : Promise.resolve({ data: { data: [team(9, 'reviewers')] } }),
    );

    const matches = await service.searchTeams('reviewers', 20);

    expect(matches).toEqual([
      {
        id: 9,
        name: 'reviewers',
        organization: 'healthy',
        description: undefined,
      },
    ]);
  });

  it('applies the limit and drops teams Gitea returns without an id', async () => {
    withOrgs('topcoder');
    teamSearch.mockResolvedValue({
      data: {
        data: [
          team(1, 'a-team'),
          { name: 'no-id' },
          team(2, 'b-team'),
          team(3, 'c-team'),
        ],
      },
    });

    const matches = await service.searchTeams('team', 2);

    expect(matches.map((match) => match.id)).toEqual([1, 2]);
    expect(teamSearch).toHaveBeenCalledWith('topcoder', {
      q: 'team',
      include_desc: false,
      limit: 2,
    });
  });

  it('reuses the organization list across searches', async () => {
    withOrgs('topcoder');

    await service.searchTeams('one', 20);
    await service.searchTeams('two', 20);

    expect(adminGetAllOrgs).toHaveBeenCalledTimes(1);
    expect(teamSearch).toHaveBeenCalledTimes(2);
  });

  it('performs no Gitea calls for a blank keyword', async () => {
    withOrgs('topcoder');

    expect(await service.searchTeams('   ', 20)).toEqual([]);
    expect(adminGetAllOrgs).not.toHaveBeenCalled();
  });
});
