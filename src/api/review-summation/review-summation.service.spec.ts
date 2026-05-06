jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ReviewSummationService } from './review-summation.service';
import { UserRole } from 'src/shared/enums/userRole.enum';

describe('ReviewSummationService', () => {
  describe('searchSummation', () => {
    it('limits submitters to their own summations and returns only safe progress metadata', async () => {
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
                memberId: 'member-1',
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
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
      };
      const challengeApiServiceMock = {
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-1',
          type: 'Marathon Match',
          legacy: {},
          phases: [],
        }),
      };
      const resourceApiServiceMock = {
        getResources: jest.fn().mockResolvedValue([{ id: 'resource-1' }]),
        validateSubmitterRegistration: jest.fn(),
      };
      const service = new ReviewSummationService(
        prismaMock as any,
        {} as any,
        challengeApiServiceMock as any,
        { member: { findMany: jest.fn().mockResolvedValue([]) } } as any,
        resourceApiServiceMock as any,
      );

      const result = await service.searchSummation(
        {
          userId: 'member-1',
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
                memberId: 'member-1',
              },
            },
          }),
        }),
      );
      expect(result.data[0].metadata).toEqual({
        testProcess: 'provisional',
        testProgress: 0.5,
        testStatus: 'IN PROGRESS',
        testProgressDetails: {
          completedTests: 5,
          progress: 0.5,
          status: 'IN PROGRESS',
          totalTests: 10,
        },
      });
      expect(JSON.stringify(result.data[0].metadata)).not.toContain(
        '123456789',
      );
    });
  });
});
