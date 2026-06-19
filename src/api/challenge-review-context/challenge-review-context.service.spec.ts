jest.mock('../../shared/modules/global/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

import { ForbiddenException } from '@nestjs/common';
import { ChallengeReviewContextService } from './challenge-review-context.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import type { JwtUser } from 'src/shared/modules/global/jwt.service';
import {
  CreateChallengeReviewContextDto,
  UpdateChallengeReviewContextDto,
  ChallengeReviewContextStatus,
} from '../../dto/challengeReviewContext.dto';

describe('ChallengeReviewContextService', () => {
  const challengeApiMock = {
    getChallengeDetailForUser: jest.fn(),
  };

  const prismaMock = {
    challengeReviewContext: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: ChallengeReviewContextService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ChallengeReviewContextService(
      prismaMock as any,
      challengeApiMock as any,
    );
  });

  const authUser: JwtUser = { userId: 'user-1', isMachine: false };

  it('allows creating a review context for any existing challenge', async () => {
    const challenge = {
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
      phases: [],
    };
    challengeApiMock.getChallengeDetailForUser.mockResolvedValue(challenge);
    prismaMock.challengeReviewContext.findUnique.mockResolvedValue(null);
    prismaMock.challengeReviewContext.create.mockResolvedValue({
      id: 'context-1',
      challengeId: 'challenge-1',
      context: { summary: 'review context' },
      status: ChallengeReviewContextStatus.AI_GENERATED,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      createdBy: 'user-1',
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedBy: 'user-1',
    });

    const dto: CreateChallengeReviewContextDto = {
      challengeId: 'challenge-1',
      context: { summary: 'review context' },
      status: ChallengeReviewContextStatus.AI_GENERATED,
    };

    const result = await service.create(dto, authUser);

    expect(result.challengeId).toBe('challenge-1');
    expect(prismaMock.challengeReviewContext.create).toHaveBeenCalledWith({
      data: {
        challengeId: 'challenge-1',
        context: dto.context,
        status: dto.status,
        createdBy: authUser.userId?.toString(),
        updatedBy: authUser.userId?.toString(),
      },
    });
  });

  it('forbids updating a review context when challenge is not DRAFT and has no open registration phase', async () => {
    const challenge = {
      id: 'challenge-2',
      status: ChallengeStatus.COMPLETED,
      phases: [{ id: 'phase-1', name: 'Submission', isOpen: false }],
    };
    challengeApiMock.getChallengeDetailForUser.mockResolvedValue(challenge);
    prismaMock.challengeReviewContext.findUnique.mockResolvedValue({
      id: 'context-2',
      challengeId: 'challenge-2',
      context: { summary: 'existing' },
      status: ChallengeReviewContextStatus.HUMAN_APPROVED,
      createdAt: new Date(),
      createdBy: 'user-1',
      updatedAt: new Date(),
      updatedBy: 'user-1',
    });

    const dto: UpdateChallengeReviewContextDto = {
      context: { summary: 'updated context' },
    };

    await expect(service.update('challenge-2', dto, authUser)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prismaMock.challengeReviewContext.update).not.toHaveBeenCalled();
  });

  it('allows updating a review context when challenge has an open registration phase', async () => {
    const challenge = {
      id: 'challenge-3',
      status: ChallengeStatus.ACTIVE,
      phases: [{ id: 'phase-2', name: 'Registration', isOpen: true }],
    };
    challengeApiMock.getChallengeDetailForUser.mockResolvedValue(challenge);
    prismaMock.challengeReviewContext.findUnique.mockResolvedValue({
      id: 'context-3',
      challengeId: 'challenge-3',
      context: { summary: 'existing' },
      status: ChallengeReviewContextStatus.HUMAN_APPROVED,
      createdAt: new Date(),
      createdBy: 'user-1',
      updatedAt: new Date(),
      updatedBy: 'user-1',
    });
    prismaMock.challengeReviewContext.update.mockResolvedValue({
      id: 'context-3',
      challengeId: 'challenge-3',
      context: { summary: 'updated context' },
      status: ChallengeReviewContextStatus.HUMAN_APPROVED,
      createdAt: new Date(),
      createdBy: 'user-1',
      updatedAt: new Date(),
      updatedBy: 'user-1',
    });

    const dto: UpdateChallengeReviewContextDto = {
      context: { summary: 'updated context' },
      status: ChallengeReviewContextStatus.HUMAN_APPROVED,
    };

    const result = await service.update('challenge-3', dto, authUser);

    expect(result.context).toEqual({ summary: 'updated context' });
    expect(prismaMock.challengeReviewContext.update).toHaveBeenCalledWith({
      where: { challengeId: 'challenge-3' },
      data: {
        context: dto.context,
        status: dto.status,
        updatedBy: authUser.userId?.toString(),
      },
    });
  });
});
