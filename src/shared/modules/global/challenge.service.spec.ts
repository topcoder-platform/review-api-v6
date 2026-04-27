import { ForbiddenException } from '@nestjs/common';
import { ChallengeApiService } from './challenge.service';

describe('ChallengeApiService whitelist access', () => {
  const challengePrismaMock = {
    $queryRaw: jest.fn(),
  } as any;

  let service: ChallengeApiService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ChallengeApiService(challengePrismaMock);
  });

  it('keeps challenges visible when there are no whitelist rows', async () => {
    challengePrismaMock.$queryRaw.mockResolvedValue([]);

    await expect(
      service.filterChallengeIdsByWhitelist(
        { userId: 'member-1', isMachine: false } as any,
        ['challenge-1'],
      ),
    ).resolves.toEqual(['challenge-1']);
  });

  it('allows only matching users when whitelist rows exist', async () => {
    challengePrismaMock.$queryRaw.mockResolvedValue([
      { challengeId: 'challenge-1', userId: 'member-1' },
      { challengeId: 'challenge-2', userId: 'member-2' },
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
});
