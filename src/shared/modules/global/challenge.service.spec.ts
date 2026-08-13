import { ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import { ChallengeApiService } from './challenge.service';

describe('ChallengeApiService whitelist access', () => {
  const challengePrismaMock = {
    $queryRaw: jest.fn(),
  } as any;

  let service: ChallengeApiService;
  const httpServiceMock = { get: jest.fn() } as any;
  const m2mServiceMock = { getM2MToken: jest.fn() } as any;

  beforeEach(() => {
    jest.resetAllMocks();
    m2mServiceMock.getM2MToken.mockResolvedValue('m2m-token');
    service = new ChallengeApiService(
      challengePrismaMock,
      httpServiceMock,
      m2mServiceMock,
    );
  });

  it('keeps challenges visible when there are no whitelist rows', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'challenge-1', groups: [] }]);

    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'member-1', isMachine: false } as any,
        ['challenge-1'],
      ),
    ).resolves.toEqual(['challenge-1']);
  });

  it('allows only matching users when whitelist rows exist', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([
        { challengeId: 'challenge-1', userId: 'member-1' },
        { challengeId: 'challenge-2', userId: 'member-2' },
      ])
      .mockResolvedValueOnce([
        { id: 'challenge-1', groups: [] },
        { id: 'challenge-3', groups: [] },
      ]);

    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'member-1', isMachine: false } as any,
        ['challenge-1', 'challenge-2', 'challenge-3'],
      ),
    ).resolves.toEqual(['challenge-1', 'challenge-3']);
  });

  it('bypasses whitelist evaluation for machine callers', async () => {
    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'machine-client', isMachine: true } as any,
        ['challenge-1'],
      ),
    ).resolves.toEqual(['challenge-1']);

    expect(challengePrismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed for direct interactive access when evaluation fails', async () => {
    challengePrismaMock.$queryRaw.mockRejectedValue(new Error('db down'));

    await expect(
      service.ensureChallengeWhitelistAccess(
        { userId: 'member-1', isMachine: false } as any,
        'challenge-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides group-restricted challenges from anonymous callers', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'public-challenge', groups: [] },
        { id: 'private-challenge', groups: ['group-1'] },
      ]);

    await expect(
      service.filterChallengeIdsByWhitelist(undefined, [
        'public-challenge',
        'private-challenge',
      ]),
    ).resolves.toEqual(['public-challenge']);
    expect(httpServiceMock.get).not.toHaveBeenCalled();
  });

  it('hides task challenges from anonymous callers', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'public-challenge',
          groups: [],
          taskIsTask: false,
          hasMemberAccess: false,
        },
        {
          id: 'private-task',
          groups: [],
          taskIsTask: true,
          hasMemberAccess: false,
        },
      ]);

    await expect(
      service.filterChallengeIdsByWhitelist(undefined, [
        'public-challenge',
        'private-task',
      ]),
    ).resolves.toEqual(['public-challenge']);
  });

  it('allows a task only when the authenticated member has challenge access', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'accessible-task',
          groups: [],
          taskIsTask: true,
          hasMemberAccess: true,
        },
        {
          id: 'other-task',
          groups: [],
          taskIsTask: true,
          hasMemberAccess: false,
        },
      ]);
    httpServiceMock.get.mockReturnValue(of({ data: [] }));

    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'member-1', roles: [], isMachine: false } as any,
        ['accessible-task', 'other-task'],
      ),
    ).resolves.toEqual(['accessible-task']);
  });

  it('allows a resource holder to see a grouped challenge without a second group lookup match', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'assigned-challenge',
          groups: ['private-group'],
          taskIsTask: false,
          hasMemberAccess: true,
        },
      ]);
    httpServiceMock.get.mockReturnValue(of({ data: [] }));

    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'member-1', roles: [], isMachine: false } as any,
        ['assigned-challenge'],
      ),
    ).resolves.toEqual(['assigned-challenge']);
  });

  it('allows a member challenge from the complete groups API tree', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'public-challenge', groups: [] },
        { id: 'private-challenge', groups: ['parent-group'] },
        { id: 'other-challenge', groups: ['other-group'] },
      ]);
    httpServiceMock.get.mockReturnValue(
      of({
        data: {
          result: {
            content: [{ id: 'child-group', ancestors: ['parent-group'] }],
          },
        },
      }),
    );

    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'member-1', roles: [], isMachine: false } as any,
        ['public-challenge', 'private-challenge', 'other-challenge'],
      ),
    ).resolves.toEqual(['public-challenge', 'private-challenge']);
    expect(m2mServiceMock.getM2MToken).toHaveBeenCalledTimes(1);
  });

  it('fails closed only for restricted challenges when groups API is down', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'public-challenge', groups: [] },
        { id: 'private-challenge', groups: ['group-1'] },
      ]);
    m2mServiceMock.getM2MToken.mockRejectedValue(new Error('groups down'));

    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'member-1', roles: [], isMachine: false } as any,
        ['public-challenge', 'private-challenge'],
      ),
    ).resolves.toEqual(['public-challenge']);
  });

  it('hydrates the Markdown challenge description for opportunity details', async () => {
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'challenge-1',
          name: 'Design Dashboard',
          description: '# Build the dashboard',
          status: 'ACTIVE',
          typeId: 'type-1',
          trackId: 'track-1',
          numOfSubmissions: 3,
          tags: ['Figma'],
          legacyId: 123,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: 'admin',
          updatedAt: new Date('2026-08-02T00:00:00.000Z'),
          updatedBy: 'admin',
        },
      ])
      .mockResolvedValueOnce([
        { track: 'DESIGN', subTrack: 'WEB_DESIGNS', legacySystemId: 123 },
      ])
      .mockResolvedValueOnce([{ name: 'Challenge' }])
      .mockResolvedValueOnce([
        { name: 'Design', abbreviation: 'DES', track: 'DESIGN' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.getChallengeDetail('challenge-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'challenge-1',
        description: '# Build the dashboard',
      }),
    );
  });

  it('batch-hydrates opportunity card data without detail relations', async () => {
    challengePrismaMock.$queryRaw.mockResolvedValue([
      {
        id: 'challenge-2',
        name: 'Second Challenge',
        description: 'Second description',
        status: 'COMPLETED',
        typeId: 'type-1',
        trackId: 'track-1',
        numOfSubmissions: 5,
        tags: ['React'],
        legacyId: 102,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: 'admin',
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        updatedBy: 'admin',
        legacyTrack: 'DEVELOPMENT',
        legacySubTrack: 'CODE',
        legacySystemId: 102,
        typeName: 'Challenge',
        trackName: 'Development',
        trackAbbreviation: 'DEV',
        trackEnum: 'DEVELOPMENT',
      },
      {
        id: 'challenge-1',
        name: 'First Challenge',
        description: '# First',
        status: 'ACTIVE',
        typeId: 'type-2',
        trackId: 'track-2',
        numOfSubmissions: 2,
        tags: ['Figma'],
        legacyId: 101,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: 'admin',
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        updatedBy: 'admin',
        legacyTrack: 'DESIGN',
        legacySubTrack: 'WEB_DESIGNS',
        legacySystemId: 101,
        typeName: 'Challenge',
        trackName: 'Design',
        trackAbbreviation: 'DES',
        trackEnum: 'DESIGN',
      },
    ]);

    await expect(
      service.getChallengeSummaries(['challenge-1', 'challenge-2']),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'challenge-1',
        description: '# First',
        track: 'Design',
        legacy: { track: 'DESIGN', subTrack: 'WEB_DESIGNS' },
      }),
      expect.objectContaining({
        id: 'challenge-2',
        track: 'Development',
        status: 'COMPLETED',
      }),
    ]);
    expect(challengePrismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
