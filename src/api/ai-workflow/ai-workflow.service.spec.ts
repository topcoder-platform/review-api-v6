import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
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
      create: jest.fn(),
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
  const resourceApiServiceMock = {
    getMemberResourcesRoles: jest.fn(),
  } as any;
  const aiReviewerDecisionMakerMock = {
    evaluateSubmission: jest.fn(),
  } as any;
  const giteaServiceMock = {} as any;
  const workflowQueueHandlerMock = {
    rebuildSubmissionDecision: jest.fn(),
  } as any;
  const challengePrismaMock = {} as any;

  beforeAll(async () => {
    const imported = await import('./ai-workflow.service');
    AiWorkflowService = imported.AiWorkflowService;
    service = new AiWorkflowService(
      prismaMock,
      memberPrismaMock,
      challengeApiServiceMock,
      resourceApiServiceMock,
      aiReviewerDecisionMakerMock,
      giteaServiceMock,
      workflowQueueHandlerMock,
      {} as any,
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
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      challengeId: 'challenge-1',
    });
  });

  it('rebuilds the AI decision for a submission', async () => {
    await service.rebuildSubmissionDecision('submission-1');

    expect(prismaMock.submission.findUnique).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      select: { id: true },
    });
    expect(workflowQueueHandlerMock.rebuildSubmissionDecision).toHaveBeenCalledWith(
      'submission-1',
    );
  });

  describe('manual workflow run triggering', () => {
    const challengeCopilot: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    beforeEach(() => {
      prismaMock.aiWorkflowRun.findUnique.mockResolvedValue({
        id: runId,
        workflowId,
        submissionId: 'submission-1',
        workflow: { id: workflowId, disabled: false },
        submission: {
          id: 'submission-1',
          challengeId: 'challenge-1',
          memberId: 'member-1',
        },
      });
      prismaMock.aiWorkflowRun.create.mockResolvedValue({
        id: 'run-2',
        workflowId,
        submissionId: 'submission-1',
      });
      workflowQueueHandlerMock.isDispatchEnabled = false;
    });

    it('allows the challenge copilot to retrigger a run', async () => {
      resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Copilot' },
      ]);

      await expect(
        service.retriggerWorkflowRun(challengeCopilot, runId),
      ).resolves.toEqual(expect.objectContaining({ id: 'run-2' }));
      expect(
        resourceApiServiceMock.getMemberResourcesRoles,
      ).toHaveBeenCalledWith('challenge-1', 'copilot-1');
    });

    it('rejects a copilot that is not assigned to the challenge', async () => {
      resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Reviewer' },
      ]);

      await expect(
        service.retriggerWorkflowRun(challengeCopilot, runId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.aiWorkflowRun.create).not.toHaveBeenCalled();
    });

    it('rejects queueing missing runs for a non copilot user', async () => {
      prismaMock.submission.findUnique.mockResolvedValue({
        id: 'submission-1',
        challengeId: 'challenge-1',
        virusScan: true,
      });
      resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

      await expect(
        service.queueWorkflowRunsForSubmission(user, {
          submissionId: 'submission-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets admins retrigger without a challenge resource lookup', async () => {
      await service.retriggerWorkflowRun(
        { userId: 'admin-1', roles: [UserRole.Admin], isMachine: false },
        runId,
      );

      expect(
        resourceApiServiceMock.getMemberResourcesRoles,
      ).not.toHaveBeenCalled();
      expect(prismaMock.aiWorkflowRun.create).toHaveBeenCalled();
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

  describe('score edits on deterministic workflows', () => {
    const copilot: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    beforeEach(() => {
      challengeApiServiceMock.isPhaseOpen.mockResolvedValue(true);
      jest.spyOn(service, 'computeRunScoreForRunItem').mockResolvedValue(42);
      prismaMock.aiWorkflowRunItem.update.mockReturnValue('item-update');
      prismaMock.aiWorkflowRunItemComment.create.mockReturnValue(
        'comment-create',
      );
      prismaMock.aiWorkflowRun.update.mockReturnValue('run-update');
      prismaMock.$transaction.mockResolvedValue([{ id: itemId }]);
    });

    it('allows a privileged user to edit the score when a reason is provided', async () => {
      await service.updateRunItem(
        workflowId,
        runId,
        itemId,
        { questionScore: 0, comment: 'False positive in test fixtures' },
        copilot,
      );

      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenCalledWith(
        'challenge-1',
        ['Approval', 'Review'],
      );
      expect(prismaMock.aiWorkflowRunItem.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { questionScore: 0, originalQuestionScore: 1 },
      });
      expect(prismaMock.aiWorkflowRunItemComment.create).toHaveBeenCalledWith({
        data: {
          workflowRunItemId: itemId,
          content: 'False positive in test fixtures',
          userId: 'copilot-1',
        },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledWith([
        'item-update',
        'comment-create',
        'run-update',
      ]);
      expect(
        aiReviewerDecisionMakerMock.evaluateSubmission,
      ).toHaveBeenCalledWith('submission-1');
    });

    it('requires a reason when editing the score', async () => {
      await expect(
        service.updateRunItem(
          workflowId,
          runId,
          itemId,
          { questionScore: 0 },
          copilot,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects score edits when neither Review nor Approval is open', async () => {
      challengeApiServiceMock.isPhaseOpen.mockResolvedValue(false);

      await expect(
        service.updateRunItem(
          workflowId,
          runId,
          itemId,
          { questionScore: 0, comment: 'False positive' },
          copilot,
        ),
      ).rejects.toThrow(
        'Question score edits are only allowed during the review or approval phase.',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('keeps AI-assisted workflow score edits limited to the Approval phase', async () => {
      prismaMock.aiWorkflow.findUnique.mockResolvedValue({
        id: workflowId,
        reviewMethod: ReviewMethod.AI_ASSISTED,
      });
      challengeApiServiceMock.isPhaseOpen.mockResolvedValue(false);

      await expect(
        service.updateRunItem(
          workflowId,
          runId,
          itemId,
          { questionScore: 0, comment: 'False positive' },
          copilot,
        ),
      ).rejects.toThrow(
        'Question score edits are only allowed during the approval phase.',
      );
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenCalledWith(
        'challenge-1',
        'Approval',
      );
    });

    it('rejects score edits from non-privileged users', async () => {
      await expect(
        service.updateRunItem(
          workflowId,
          runId,
          itemId,
          { questionScore: 0, comment: 'Not a reviewer decision' },
          user,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
