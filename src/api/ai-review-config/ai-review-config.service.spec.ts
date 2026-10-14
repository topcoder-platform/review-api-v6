jest.mock('../../shared/modules/global/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

import { ConflictException } from '@nestjs/common';
import { AiReviewConfigService } from './ai-review-config.service';
import { AiReviewMode } from '../../dto/aiReviewTemplateConfig.dto';
import { UpdateAiReviewConfigDto } from '../../dto/aiReviewConfig.dto';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import type { JwtUser } from 'src/shared/modules/global/jwt.service';

describe('AiReviewConfigService', () => {
  const configId = 'config-1';
  const challengeId = 'challenge-1';
  const persistedConfig = {
    id: configId,
    challengeId,
    version: 1,
    minPassingThreshold: 75,
    mode: 'AI_ONLY',
    autoFinalize: false,
    instantReview: false,
    formula: null,
    templateId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    workflows: [
      {
        id: 'config-workflow-1',
        workflowId: 'workflow-1',
        weightPercent: 100,
        isGating: false,
        workflow: {},
      },
    ],
    decisions: [],
  };
  const modeSwitchDto: UpdateAiReviewConfigDto = {
    autoFinalize: false,
    instantReview: false,
    minPassingThreshold: 75,
    mode: AiReviewMode.AI_GATING,
    templateId: '',
    workflows: [
      {
        workflowId: 'workflow-1',
        weightPercent: 100,
        isGating: false,
      },
    ],
  };
  const authUser: JwtUser = { userId: 'admin-1', isMachine: true };

  const txMock = {
    aiReviewConfig: { update: jest.fn() },
    aiReviewConfigWorkflow: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const prismaMock = {
    $transaction: jest.fn(),
    aiReviewConfig: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    aiReviewDecision: { count: jest.fn() },
    aiWorkflow: { findMany: jest.fn() },
    aiWorkflowRun: { count: jest.fn() },
    submission: { count: jest.fn() },
  };
  const challengeApiMock = {
    getChallengeDetail: jest.fn(),
  };

  let service: AiReviewConfigService;

  /**
   * Builds the challenge returned by challenge-api with the given phases.
   */
  const buildChallenge = (
    phases: Array<{
      name: string;
      isOpen: boolean;
      actualStartTime?: string;
    }>,
  ) => ({
    id: challengeId,
    status: ChallengeStatus.ACTIVE,
    phases: phases.map((phase, index) => ({ id: `phase-${index}`, ...phase })),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AiReviewConfigService(
      prismaMock as any,
      challengeApiMock as any,
      {} as any,
      {} as any,
    );
    prismaMock.aiReviewConfig.findUnique.mockResolvedValue(persistedConfig);
    prismaMock.aiReviewDecision.count.mockResolvedValue(0);
    prismaMock.aiWorkflowRun.count.mockResolvedValue(0);
    prismaMock.aiWorkflow.findMany.mockResolvedValue([
      { id: 'workflow-1', disabled: false },
    ]);
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
    );
  });

  describe('update', () => {
    it('switches the review mode of a challenge with submissions before the review phase starts', async () => {
      prismaMock.submission.count.mockResolvedValue(2);
      challengeApiMock.getChallengeDetail.mockResolvedValue(
        buildChallenge([
          {
            name: 'Registration',
            isOpen: true,
            actualStartTime: '2026-01-02T00:00:00.000Z',
          },
          {
            name: 'Submission',
            isOpen: true,
            actualStartTime: '2026-01-02T00:00:00.000Z',
          },
          { name: 'AI Review', isOpen: false },
          { name: 'Approval', isOpen: false },
        ]),
      );

      await service.update(configId, modeSwitchDto, authUser);

      expect(txMock.aiReviewConfig.update).toHaveBeenCalledWith({
        where: { id: configId },
        data: expect.objectContaining({ mode: AiReviewMode.AI_GATING }),
      });
    });

    it('keeps other settings locked once the challenge has submissions', async () => {
      prismaMock.submission.count.mockResolvedValue(2);

      await expect(
        service.update(
          configId,
          { ...modeSwitchDto, minPassingThreshold: 80 },
          authUser,
        ),
      ).rejects.toThrow(
        new ConflictException(
          `Cannot update AI review config: challenge ${challengeId} already has submissions. Only the review mode can be switched until the review phase starts.`,
        ),
      );
      expect(prismaMock.aiReviewConfig.update).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a review mode switch once a review phase has started', async () => {
      prismaMock.submission.count.mockResolvedValue(2);
      challengeApiMock.getChallengeDetail.mockResolvedValue(
        buildChallenge([
          {
            name: 'Submission',
            isOpen: false,
            actualStartTime: '2026-01-02T00:00:00.000Z',
          },
          {
            name: 'AI Screening',
            isOpen: true,
            actualStartTime: '2026-01-07T00:00:00.000Z',
          },
          { name: 'Review', isOpen: false },
        ]),
      );

      await expect(
        service.update(configId, modeSwitchDto, authUser),
      ).rejects.toThrow(
        new ConflictException(
          `Cannot switch the AI review mode: the AI Screening phase of challenge ${challengeId} has already started.`,
        ),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('allows any setting to change before the first submission', async () => {
      prismaMock.submission.count.mockResolvedValue(0);
      challengeApiMock.getChallengeDetail.mockResolvedValue(
        buildChallenge([{ name: 'Registration', isOpen: true }]),
      );

      await service.update(
        configId,
        { minPassingThreshold: 80, instantReview: true },
        authUser,
      );

      expect(prismaMock.aiReviewConfig.update).toHaveBeenCalledWith({
        where: { id: configId },
        data: { minPassingThreshold: 80, instantReview: true },
      });
    });
  });
});
