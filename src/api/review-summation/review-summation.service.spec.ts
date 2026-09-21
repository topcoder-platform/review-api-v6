jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ForbiddenException } from '@nestjs/common';

import { ReviewSummationService } from './review-summation.service';
import { UserRole } from 'src/shared/enums/userRole.enum';

describe('ReviewSummationService', () => {
  describe('searchSummation', () => {
    it('allows signed-in members to view marathon challenge summations without metadata', async () => {
      const prismaMock = {
        reviewSummation: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'summation-1',
              submissionId: 'submission-1',
              aggregateScore: -1,
              scorecardId: null,
              isPassing: false,
              isFinal: false,
              isProvisional: true,
              isExample: false,
              reviewedDate: null,
              createdAt: new Date('2026-05-01T00:00:00.000Z'),
              createdBy: null,
              updatedAt: null,
              updatedBy: null,
              submission: {
                memberId: '111',
              },
              metadata: {
                testProcess: 'provisional',
                testProgress: 0.5,
                testStatus: 'IN PROGRESS',
                testScores: [
                  {
                    score: 11,
                    seed: 123456789,
                  },
                ],
                testProgressDetails: {
                  completedTests: 5,
                  failedTests: [{ seed: 123456789 }],
                  message: 'Completed seed 123456789',
                  progress: 0.5,
                  status: 'IN PROGRESS',
                  totalTests: 10,
                },
              },
            },
            {
              id: 'summation-2',
              submissionId: 'submission-2',
              aggregateScore: 100,
              scorecardId: null,
              isPassing: true,
              isFinal: false,
              isProvisional: true,
              isExample: false,
              reviewedDate: null,
              createdAt: new Date('2026-05-01T00:00:00.000Z'),
              createdBy: null,
              updatedAt: null,
              updatedBy: null,
              submission: {
                memberId: '222',
              },
              metadata: {
                testProcess: 'provisional',
                testScores: [
                  {
                    score: 100,
                    seed: 987654321,
                  },
                ],
              },
            },
          ]),
          count: jest.fn().mockResolvedValue(2),
        },
      };
      const challengeApiServiceMock = {
        ensureChallengeWhitelistAccess: jest.fn().mockResolvedValue(undefined),
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-1',
          type: 'Marathon Match',
          legacy: {},
          phases: [],
        }),
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        challengeApiServiceMock as any,
        { member: { findMany: jest.fn().mockResolvedValue([]) } } as any,
      );

      const result = await service.searchSummation(
        {
          userId: '111',
          isMachine: false,
          roles: [UserRole.User],
        },
        {
          challengeId: 'challenge-1',
          metadata: 'true',
        },
        {
          page: 1,
          perPage: 10,
        },
      );

      expect(prismaMock.reviewSummation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submission: {
              is: {
                challengeId: 'challenge-1',
              },
            },
          }),
        }),
      );
      const findManyArg = prismaMock.reviewSummation.findMany.mock.calls[0][0];
      expect(findManyArg.select).not.toHaveProperty('metadata');
      expect(result.data).toHaveLength(2);
      expect(result.data.map((summation) => summation.submitterId)).toEqual([
        111, 222,
      ]);
      expect(result.data[0]).not.toHaveProperty('metadata');
      expect(result.data[1]).not.toHaveProperty('metadata');
      expect(JSON.stringify(result.data)).not.toContain('123456789');
      expect(JSON.stringify(result.data)).not.toContain('987654321');
    });

    it('returns metadata to machine callers that explicitly request it', async () => {
      const metadata = {
        testProcess: 'provisional',
        testScores: [
          {
            score: 11,
            seed: 123456789,
          },
        ],
      };
      const prismaMock = {
        reviewSummation: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'summation-1',
              submissionId: 'submission-1',
              aggregateScore: -1,
              scorecardId: null,
              isPassing: false,
              isFinal: false,
              isProvisional: true,
              isExample: false,
              reviewedDate: null,
              createdAt: new Date('2026-05-01T00:00:00.000Z'),
              createdBy: null,
              updatedAt: null,
              updatedBy: null,
              metadata,
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        {} as any,
        { member: { findMany: jest.fn().mockResolvedValue([]) } } as any,
      );

      const result = await service.searchSummation(
        {
          isMachine: true,
          roles: [],
        },
        {
          submissionId: 'submission-1',
          metadata: 'true',
          provisional: 'true',
        },
        {
          page: 1,
          perPage: 10,
        },
      );

      const findManyArg = prismaMock.reviewSummation.findMany.mock.calls[0][0];
      expect(findManyArg.select).toHaveProperty('metadata', true);
      expect(findManyArg.select).not.toHaveProperty('submission');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].metadata).toEqual(metadata);
      expect(result.data[0]).not.toHaveProperty('submission');
    });

    it('allows anonymous visitors to read a public marathon leaderboard', async () => {
      const prismaMock = {
        reviewSummation: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'summation-1',
              submissionId: 'submission-1',
              aggregateScore: 88.5,
              scorecardId: null,
              isPassing: true,
              isFinal: false,
              isProvisional: true,
              isExample: false,
              reviewedDate: null,
              createdAt: new Date('2026-05-01T00:00:00.000Z'),
              createdBy: null,
              updatedAt: null,
              updatedBy: null,
              submission: { memberId: '222' },
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
      };
      const challengeApiServiceMock = {
        ensureChallengeWhitelistAccess: jest.fn().mockResolvedValue(undefined),
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-1',
          type: 'Marathon Match',
          legacy: {},
          phases: [],
        }),
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        challengeApiServiceMock as any,
        {
          member: {
            findMany: jest.fn().mockResolvedValue([
              { userId: 222n, handle: 'coder', maxRating: { rating: 1500 } },
            ]),
          },
        } as any,
      );

      const result = await service.searchSummation(
        undefined,
        { challengeId: 'challenge-1' },
        { page: 1, perPage: 10 },
      );

      expect(
        challengeApiServiceMock.ensureChallengeWhitelistAccess,
      ).toHaveBeenCalledWith(undefined, 'challenge-1');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].submitterHandle).toBe('coder');
      expect(result.data[0]).not.toHaveProperty('metadata');
    });

    it('rejects anonymous visitors that omit a challengeId', async () => {
      const prismaMock = {
        reviewSummation: { findMany: jest.fn(), count: jest.fn() },
      };
      const challengeApiServiceMock = {
        ensureChallengeWhitelistAccess: jest.fn(),
        getChallengeDetail: jest.fn(),
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        challengeApiServiceMock as any,
        { member: { findMany: jest.fn() } } as any,
      );

      await expect(
        service.searchSummation(undefined, {}, { page: 1, perPage: 10 }),
      ).rejects.toMatchObject({
        response: { code: 'SUBMITTER_CHALLENGE_ID_REQUIRED' },
      });
      expect(prismaMock.reviewSummation.findMany).not.toHaveBeenCalled();
    });

    it('rejects anonymous visitors on non-marathon challenges', async () => {
      const prismaMock = {
        reviewSummation: { findMany: jest.fn(), count: jest.fn() },
      };
      const challengeApiServiceMock = {
        ensureChallengeWhitelistAccess: jest.fn().mockResolvedValue(undefined),
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-1',
          type: 'Code',
          legacy: {},
          phases: [],
        }),
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        challengeApiServiceMock as any,
        { member: { findMany: jest.fn() } } as any,
      );

      await expect(
        service.searchSummation(
          undefined,
          { challengeId: 'challenge-1' },
          { page: 1, perPage: 10 },
        ),
      ).rejects.toMatchObject({
        response: { code: 'SUBMITTER_NON_MARATHON_FORBIDDEN' },
      });
      expect(prismaMock.reviewSummation.findMany).not.toHaveBeenCalled();
    });

    it('hides summations for challenges the anonymous visitor cannot see', async () => {
      const prismaMock = {
        reviewSummation: { findMany: jest.fn(), count: jest.fn() },
      };
      const challengeApiServiceMock = {
        ensureChallengeWhitelistAccess: jest
          .fn()
          .mockRejectedValue(
            new ForbiddenException({
              message: "You don't have access to view this challenge",
              code: 'FORBIDDEN_CHALLENGE_WHITELIST',
            }),
          ),
        getChallengeDetail: jest.fn(),
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        challengeApiServiceMock as any,
        { member: { findMany: jest.fn() } } as any,
      );

      await expect(
        service.searchSummation(
          undefined,
          { challengeId: 'private-challenge' },
          { page: 1, perPage: 10 },
        ),
      ).rejects.toMatchObject({
        response: { code: 'FORBIDDEN_CHALLENGE_WHITELIST' },
      });
      expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
      expect(prismaMock.reviewSummation.findMany).not.toHaveBeenCalled();
    });

    it('no longer requires registration for signed-in marathon viewers', async () => {
      const prismaMock = {
        reviewSummation: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      };
      const challengeApiServiceMock = {
        ensureChallengeWhitelistAccess: jest.fn().mockResolvedValue(undefined),
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-1',
          type: 'Marathon Match',
          legacy: {},
          phases: [],
        }),
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        challengeApiServiceMock as any,
        { member: { findMany: jest.fn().mockResolvedValue([]) } } as any,
      );

      const result = await service.searchSummation(
        { userId: '999', isMachine: false, roles: [UserRole.User] },
        { challengeId: 'challenge-1' },
        { page: 1, perPage: 10 },
      );

      expect(result.data).toEqual([]);
      expect(prismaMock.reviewSummation.findMany).toHaveBeenCalled();
    });
  });
});
