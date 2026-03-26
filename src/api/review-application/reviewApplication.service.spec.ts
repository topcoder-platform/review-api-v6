jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ReviewOpportunityType } from '@prisma/client';
import {
  ReviewApplicationRole,
  ReviewApplicationStatus,
} from 'src/dto/reviewApplication.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import { ReviewApplicationService } from './reviewApplication.service';

describe('ReviewApplicationService', () => {
  let service: ReviewApplicationService;

  const prismaMock = {
    reviewApplication: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const challengeServiceMock = {
    getChallengeDetail: jest.fn(),
  };

  const challengePrismaMock = {
    $queryRaw: jest.fn(),
  };

  const resourcePrismaMock = {
    resourceRole: {
      findFirst: jest.fn(),
    },
    resource: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const memberServiceMock = {
    getUserEmails: jest.fn(),
  };

  const eventBusServiceMock = {
    sendEmail: jest.fn(),
  };

  const prismaErrorServiceMock = {
    handleError: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new ReviewApplicationService(
      prismaMock as any,
      challengeServiceMock as any,
      challengePrismaMock as any,
      resourcePrismaMock as any,
      memberServiceMock as any,
      eventBusServiceMock as any,
      prismaErrorServiceMock as any,
    );
  });

  it('includes past review assignments in rejection email payload', async () => {
    prismaMock.reviewApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      userId: '1001',
      handle: 'reviewer-one',
      role: ReviewApplicationRole.REVIEWER,
      status: ReviewApplicationStatus.PENDING,
      startDate: new Date('2026-02-10T00:00:00Z'),
      opportunityId: 'opp-1',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      opportunity: {
        id: 'opp-1',
        challengeId: 'challenge-current',
        type: ReviewOpportunityType.REGULAR_REVIEW,
      },
    });

    prismaMock.reviewApplication.update.mockResolvedValue({ id: 'app-1' });

    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-current',
      name: 'Current Challenge',
    });

    memberServiceMock.getUserEmails.mockResolvedValue([
      { userId: '1001', email: 'reviewer@example.com', handle: 'reviewer' },
    ]);

    challengePrismaMock.$queryRaw.mockResolvedValue([
      {
        memberId: '1001',
        challengeId: 'challenge-a',
        challengeName: 'Challenge A',
        assignedAt: new Date('2026-02-01T00:00:00Z'),
      },
      {
        memberId: '1001',
        challengeId: 'challenge-b',
        challengeName: 'Challenge B',
        assignedAt: new Date('2026-01-20T00:00:00Z'),
      },
    ]);

    eventBusServiceMock.sendEmail.mockResolvedValue(undefined);

    await service.reject('app-1');

    expect(challengePrismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(eventBusServiceMock.sendEmail).toHaveBeenCalledTimes(1);
    expect(eventBusServiceMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        sendgrid_template_id: CommonConfig.sendgridConfig.rejectEmailTemplate,
        recipients: ['reviewer@example.com'],
        data: expect.objectContaining({
          handle: 'reviewer-one',
          challengeName: 'Current Challenge',
          challengeUrl:
            'https://review.topcoder.com/active-challenges/challenge-current/challenge-details',
          hasPastReviewAssignments: true,
          pastReviewAssignmentsWindowDays: 60,
          pastReviewAssignments: [
            {
              challengeId: 'challenge-a',
              challengeName: 'Challenge A',
              challengeUrl:
                'https://review.topcoder.com/active-challenges/challenge-a/challenge-details',
            },
            {
              challengeId: 'challenge-b',
              challengeName: 'Challenge B',
              challengeUrl:
                'https://review.topcoder.com/active-challenges/challenge-b/challenge-details',
            },
          ],
        }),
      }),
    );
  });

  it('sends empty assignment report when reviewer has no recent assignments', async () => {
    prismaMock.reviewApplication.findUnique.mockResolvedValue({
      id: 'app-2',
      userId: '1002',
      handle: 'reviewer-two',
      role: ReviewApplicationRole.REVIEWER,
      status: ReviewApplicationStatus.PENDING,
      startDate: new Date('2026-02-11T00:00:00Z'),
      opportunityId: 'opp-2',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      opportunity: {
        id: 'opp-2',
        challengeId: 'challenge-current-2',
        type: ReviewOpportunityType.REGULAR_REVIEW,
      },
    });

    prismaMock.reviewApplication.update.mockResolvedValue({ id: 'app-2' });

    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-current-2',
      name: 'Current Challenge 2',
    });

    memberServiceMock.getUserEmails.mockResolvedValue([
      { userId: '1002', email: 'reviewer2@example.com', handle: 'reviewer2' },
    ]);

    challengePrismaMock.$queryRaw.mockResolvedValue([]);

    eventBusServiceMock.sendEmail.mockResolvedValue(undefined);

    await service.reject('app-2');

    expect(eventBusServiceMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hasPastReviewAssignments: false,
          pastReviewAssignmentsWindowDays: 60,
          pastReviewAssignments: [],
        }),
      }),
    );
  });
});
