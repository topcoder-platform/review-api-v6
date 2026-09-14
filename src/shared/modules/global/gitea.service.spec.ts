import { GiteaService } from './gitea.service';

describe('GiteaService.searchTeams', () => {
  const team = (id: number, name: string, description?: string) => ({
    id,
    name,
    description,
  });

  let teamSearch: jest.Mock;
  let service: GiteaService;
  let orgs: string[];

  /**
   * Sets the organizations passed to `searchTeams` by the tests below.
   */
  const withOrgs = (...organizations: string[]) => {
    orgs = organizations;
  };

  beforeEach(() => {
    teamSearch = jest.fn().mockResolvedValue({ data: { data: [] } });
    orgs = [];
    service = new GiteaService();
    (service as unknown as { giteaClient: unknown }).giteaClient = {
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

    const matches = await service.searchTeams('reviewers', 20, orgs);

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

    const matches = await service.searchTeams('devs', 20, orgs);

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

    const matches = await service.searchTeams('reviewers', 20, orgs);

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

    const matches = await service.searchTeams('team', 2, orgs);

    expect(matches.map((match) => match.id)).toEqual([1, 2]);
    expect(teamSearch).toHaveBeenCalledWith('topcoder', {
      q: 'team',
      include_desc: false,
      limit: 2,
    });
  });

  it('performs no Gitea calls for a blank keyword', async () => {
    withOrgs('topcoder');

    expect(await service.searchTeams('   ', 20, orgs)).toEqual([]);
    expect(teamSearch).not.toHaveBeenCalled();
  });

  it('finds nothing when no organization is given', async () => {
    withOrgs();

    expect(await service.searchTeams('reviewers', 20, orgs)).toEqual([]);
    expect(teamSearch).not.toHaveBeenCalled();
  });
});

describe('GiteaService user and organization lookups', () => {
  let userSearch: jest.Mock;
  let orgListUserOrgs: jest.Mock;
  let service: GiteaService;

  beforeEach(() => {
    userSearch = jest.fn().mockResolvedValue({ data: { data: [] } });
    orgListUserOrgs = jest.fn().mockResolvedValue({ data: [] });
    service = new GiteaService();
    (service as unknown as { giteaClient: unknown }).giteaClient = {
      users: { userSearch, orgListUserOrgs },
    };
  });

  it('matches a user by exact email, ignoring fuzzy extras and case', async () => {
    userSearch.mockResolvedValue({
      data: {
        data: [
          { login: 'someone-else', email: 'member@example.com.br' },
          { login: 'tc-handle', email: 'Member@Example.com' },
        ],
      },
    });

    expect(await service.findUserByEmail(' MEMBER@example.com ')).toEqual({
      login: 'tc-handle',
      email: 'Member@Example.com',
    });
    expect(userSearch).toHaveBeenCalledWith({
      q: 'member@example.com',
      limit: 10,
    });
  });

  it('returns no user when nothing matches the email exactly', async () => {
    userSearch.mockResolvedValue({
      data: { data: [{ login: 'someone-else', email: 'other@example.com' }] },
    });

    expect(await service.findUserByEmail('member@example.com')).toBeNull();
  });

  it('performs no search for a blank email', async () => {
    expect(await service.findUserByEmail('  ')).toBeNull();
    expect(userSearch).not.toHaveBeenCalled();
  });

  it('lists the private and public organizations of a user', async () => {
    orgListUserOrgs.mockResolvedValue({
      data: [
        { id: 1, name: 'topcoder', visibility: 'public' },
        { id: 2, name: 'secret-partner', visibility: 'private' },
      ],
    });

    expect(await service.listUserOrganizations('tc-handle')).toEqual([
      'topcoder',
      'secret-partner',
    ]);
    expect(orgListUserOrgs).toHaveBeenCalledWith('tc-handle', {
      page: 1,
      limit: 50,
    });
  });

  it('falls back to the deprecated username field for older Gitea versions', async () => {
    orgListUserOrgs.mockResolvedValue({
      data: [{ id: 1, username: 'legacy' }],
    });

    expect(await service.listUserOrganizations('tc-handle')).toEqual([
      'legacy',
    ]);
  });

  it('reads every page of organizations', async () => {
    const fullPage = Array.from({ length: 50 }, (_unused, index) => ({
      id: index + 1,
      name: `org-${index + 1}`,
    }));
    orgListUserOrgs.mockImplementation(
      (_username: string, { page }: { page: number }) =>
        Promise.resolve({
          data: page === 1 ? fullPage : [{ id: 51, name: 'org-51' }],
        }),
    );

    const organizations = await service.listUserOrganizations('tc-handle');

    expect(organizations).toHaveLength(51);
    expect(organizations[50]).toBe('org-51');
  });
});
