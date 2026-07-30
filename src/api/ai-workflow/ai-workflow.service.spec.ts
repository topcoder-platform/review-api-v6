import { ForbiddenException } from '@nestjs/common';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ReviewMethod } from '@prisma/client';
import type { UpdateAiWorkflowRunItemDto } from 'src/dto/aiWorkflow.dto';

describe('AiWorkflowService.updateRunItem', () => {
  jest.mock('src/shared/modules/global/prisma.service', () => ({
    PrismaService: jest.fn(),
  }));
  jest.mock('src/shared/modules/global/logger.service', () => ({
    LoggerService: {
      forRoot: jest.fn(() => ({
        log: jest.fn(),
        error: jest.fn(),
      })),
    },
  }));
  jest.mock('src/shared/modules/global/challenge.service', () => ({
    ChallengeApiService: jest.fn(),
  }));
  jest.mock('src/shared/modules/global/resource.service', () => ({
    ResourceApiService: jest.fn(),
  }));
  jest.mock('src/shared/modules/global/ai-reviewer-decision-maker.service', () => ({
    AiReviewerDecisionMakerService: jest.fn(),
  }));
  jest.mock('src/shared/modules/global/gitea.service', () => ({
    GiteaService: jest.fn(),
  }));
  jest.mock('src/shared/modules/global/member-prisma.service', () => ({
    MemberPrismaService: jest.fn(),
  }));
  jest.mock('src/shared/modules/global/challenge-prisma.service', () => ({
    ChallengePrismaService: jest.fn(),
  }));
  jest.mock('src/shared/modules/global/workflow-queue.handler', () => ({
    WorkflowQueueHandler: jest.fn(),
  }));

  let AiWorkflowService: any;
  let service: any;

  const prismaMock = {
    aiWorkflow: {
      findUnique: jest.fn(),
    },
    aiWorkflowRun: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    aiWorkflowRunItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    aiWorkflowRunItemVote: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    aiWorkflowRunItemComment: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    submission: {
      findUnique: jest.fn(),
    },
  } as unknown as any;

  const memberPrismaMock = {} as any;
  const challengeApiServiceMock = {
    isPhaseOpen: jest.fn(),
  } as any;
  const resourceApiServiceMock = {} as any;
  const aiReviewerDecisionMakerMock = {
    evaluateSubmission: jest.fn(),
  } as any;
  const giteaServiceMock = {} as any;
  const workflowQueueHandlerMock = {} as any;
  const challengePrismaMock = {} as any;

  beforeAll(async () => {
    const imported = await import('./ai-workflow.service');
    AiWorkflowService = imported.AiWorkflowService;
    service = new AiWorkflowService(
      prismaMock,
      memberPrismaMock,
      {} as any,
      resourceApiServiceMock,
      aiReviewerDecisionMakerMock,
      {} as any,
      giteaServiceMock,
      workflowQueueHandlerMock,
      challengePrismaMock,
    );
  });

  const user: JwtUser = {
    userId: 'user-1',
    roles: [],
    isMachine: false,
  };

  const workflowId = 'workflow-1';
  const runId = 'run-1';
  const itemId = 'item-1';

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.aiWorkflow.findUnique.mockResolvedValue({
      id: workflowId,
      reviewMethod: ReviewMethod.DETERMINISTIC,
    });
    prismaMock.aiWorkflowRun.findUnique.mockResolvedValue({
      id: runId,
      workflowId,
      submissionId: 'submission-1',
    });
    prismaMock.aiWorkflowRunItem.findUnique.mockResolvedValue({
      id: itemId,
      workflowRunId: runId,
      scorecardQuestionId: 'question-1',
      questionScore: 1,
      originalQuestionScore: null,
    });
  });

  it('throws ForbiddenException when adding a comment to a deterministic workflow via updateRunItem', async () => {
    const patchData: UpdateAiWorkflowRunItemDto = {
      comment: 'Looks good',
    };

    await expect(
      service.updateRunItem(workflowId, runId, itemId, patchData, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
