jest.mock('../../shared/modules/global/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

import { ForbiddenException } from '@nestjs/common';
import { ChallengeReviewContextService } from './challenge-review-context.service';
import { ChallengeStatus } from '../../shared/enums/challengeStatus.enum';
import type { JwtUser } from '../../shared/modules/global/jwt.service';
import {
  CreateChallengeReviewContextDto,
  UpdateChallengeReviewContextDto,
  ChallengeReviewContextStatus,
} from '../../dto/challengeReviewContext.dto';

describe('ChallengeReviewContextService', () => {
  const challengeApiMock = {
    getChallengeDetailForUser: jest.fn(),
    getChallengeApiPayload: jest.fn(),
  };

  const prismaMock = {
    challengeReviewContext: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    scorecard: {
      findUnique: jest.fn(),
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

  it('allows updating a review context when challenge is in DRAFT status', async () => {
    const challenge = {
      id: 'challenge-4',
      status: ChallengeStatus.DRAFT,
      phases: [],
    };
    challengeApiMock.getChallengeDetailForUser.mockResolvedValue(challenge);
    prismaMock.challengeReviewContext.findUnique.mockResolvedValue({
      id: 'context-4',
      challengeId: 'challenge-4',
      context: { summary: 'existing' },
      status: ChallengeReviewContextStatus.AI_GENERATED,
      createdAt: new Date(),
      createdBy: 'user-1',
      updatedAt: new Date(),
      updatedBy: 'user-1',
    });
    prismaMock.challengeReviewContext.update.mockResolvedValue({
      id: 'context-4',
      challengeId: 'challenge-4',
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
    const result = await service.update('challenge-4', dto, authUser);
    expect(result.context).toEqual({ summary: 'updated context' });
    expect(prismaMock.challengeReviewContext.update).toHaveBeenCalledWith({
      where: { challengeId: 'challenge-4' },
      data: {
        context: dto.context,
        status: dto.status,
        updatedBy: authUser.userId?.toString(),
      },
    });
  });

  describe('getByChallengeId backfill', () => {
    const storedRow = (context: Record<string, unknown>) => ({
      id: 'context-5',
      challengeId: 'challenge-5',
      context,
      status: ChallengeReviewContextStatus.HUMAN_APPROVED,
      createdAt: new Date(),
      createdBy: 'user-1',
      updatedAt: new Date(),
      updatedBy: 'user-1',
    });

    const requirements = [
      {
        id: 'REQ_01',
        title: 'Manual requirement',
        priority: 'high',
        description: 'Entered by a copilot',
        constraints: [],
      },
    ];

    const challengePayload = {
      id: 'challenge-5',
      name: 'Build the widget',
      description: '## Spec',
      descriptionFormat: 'markdown',
      status: 'Active',
      track: { name: 'Development' },
      type: { name: 'Challenge' },
      overview: { totalPrizes: 1500 },
      numOfRegistrants: 7,
      numOfSubmissions: 2,
      task: { isTask: false },
      registrationStartDate: '2026-11-01T00:00:00.000Z',
      registrationEndDate: '2026-11-05T00:00:00.000Z',
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-11-11T00:00:00.000Z',
      prizeSets: [
        { type: 'COPILOT', prizes: [{ type: 'USD', value: 200 }] },
        {
          type: 'PLACEMENT',
          prizes: [
            { type: 'USD', value: 1000 },
            { type: 'USD', value: 500 },
          ],
        },
      ],
      skills: [{ id: 'skill-1', name: 'TypeScript', category: { id: 'c' } }],
      reviewers: [
        { scorecardId: 'sc-ai', isMemberReview: false, aiWorkflowId: 'wf-1' },
        { scorecardId: 'sc-human', isMemberReview: true, type: 'REGULAR' },
      ],
      discussions: [{ url: 'https://discussions.example/1' }],
      legacy: { reviewType: 'COMMUNITY' },
    };

    beforeEach(() => {
      challengeApiMock.getChallengeDetailForUser.mockResolvedValue({
        id: 'challenge-5',
        status: ChallengeStatus.ACTIVE,
        phases: [],
      });
    });

    it('fills missing unified-context fields for a requirements-only context', async () => {
      prismaMock.challengeReviewContext.findUnique.mockResolvedValue(
        storedRow({ requirements }),
      );
      challengeApiMock.getChallengeApiPayload.mockResolvedValue(
        challengePayload,
      );
      const scorecard = { id: 'sc-human', name: 'Dev', scorecardGroups: [] };
      prismaMock.scorecard.findUnique.mockResolvedValue(scorecard);

      const result = await service.getByChallengeId('challenge-5', authUser);

      expect(challengeApiMock.getChallengeApiPayload).toHaveBeenCalledWith(
        'challenge-5',
      );
      expect(prismaMock.scorecard.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sc-human' } }),
      );
      expect(result.context).toEqual({
        requirements,
        challengeId: 'challenge-5',
        title: 'Build the widget',
        descriptionRaw: '## Spec',
        descriptionFormat: 'markdown',
        requirement_groups: [],
        tech_stack: [],
        skills: [{ id: 'skill-1', name: 'TypeScript' }],
        challenge_metadata: {
          status: 'Active',
          track: 'Development',
          type: 'Challenge',
          totalPrizes: 1500,
          numOfRegistrants: 7,
          numOfSubmissions: 2,
          isTask: false,
        },
        timeline: {
          registrationStartDate: '2026-11-01T00:00:00.000Z',
          registrationEndDate: '2026-11-05T00:00:00.000Z',
          startDate: '2026-11-01T00:00:00.000Z',
          endDate: '2026-11-11T00:00:00.000Z',
          totalDurationDays: 10,
        },
        prizes: [
          { placement: 1, value: 1000, currency: 'USD' },
          { placement: 2, value: 500, currency: 'USD' },
        ],
        review_criteria: {
          reviewType: 'COMMUNITY',
          reviewers: [
            {
              scorecardId: 'sc-ai',
              isMemberReview: false,
              type: undefined,
              aiWorkflowId: 'wf-1',
            },
            {
              scorecardId: 'sc-human',
              isMemberReview: true,
              type: 'REGULAR',
              aiWorkflowId: undefined,
            },
          ],
          scorecard,
        },
        discussion_url: 'https://discussions.example/1',
      });
    });

    it('keeps stored fields over derived values', async () => {
      prismaMock.challengeReviewContext.findUnique.mockResolvedValue(
        storedRow({ requirements, title: 'Edited title' }),
      );
      challengeApiMock.getChallengeApiPayload.mockResolvedValue(
        challengePayload,
      );
      prismaMock.scorecard.findUnique.mockResolvedValue(null);

      const result = await service.getByChallengeId('challenge-5', authUser);

      expect(result.context.title).toBe('Edited title');
      expect(result.context.requirements).toBe(requirements);
    });

    it('does not call the challenge API when the context is complete', async () => {
      const complete = {
        challengeId: 'challenge-5',
        title: 't',
        descriptionRaw: 'd',
        descriptionFormat: 'markdown',
        requirements,
        requirement_groups: [],
        tech_stack: ['Node.js'],
        skills: [],
        challenge_metadata: {},
        timeline: {},
        prizes: [],
        review_criteria: {},
      };
      prismaMock.challengeReviewContext.findUnique.mockResolvedValue(
        storedRow(complete),
      );

      const result = await service.getByChallengeId('challenge-5', authUser);

      expect(result.context).toEqual(complete);
      expect(challengeApiMock.getChallengeApiPayload).not.toHaveBeenCalled();
    });

    it('returns the stored context unchanged when challenge data is unavailable', async () => {
      prismaMock.challengeReviewContext.findUnique.mockResolvedValue(
        storedRow({ requirements }),
      );
      challengeApiMock.getChallengeApiPayload.mockResolvedValue(null);

      const result = await service.getByChallengeId('challenge-5', authUser);

      expect(result.context).toEqual({ requirements });
      expect(prismaMock.scorecard.findUnique).not.toHaveBeenCalled();
    });
  });
});
