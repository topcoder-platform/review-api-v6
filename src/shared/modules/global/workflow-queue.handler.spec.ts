jest.mock('./gitea.service', () => ({
  GiteaService: class GiteaService {},
}));

jest.mock('./prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('./challenge-prisma.service', () => ({
  ChallengePrismaService: class ChallengePrismaService {},
}));

jest.mock('./member-prisma.service', () => ({
  MemberPrismaService: class MemberPrismaService {},
}));

jest.mock('./eventBus.service', () => ({
  EventBusService: class EventBusService {},
  EventBusSendEmailPayload: class EventBusSendEmailPayload {},
}));

jest.mock('./ai-reviewer-decision-maker.service', () => ({
  AiReviewerDecisionMakerService: class AiReviewerDecisionMakerService {},
}));

jest.mock('./challenge.service', () => ({
  ChallengeApiService: class ChallengeApiService {},
}));

jest.mock('src/api/submission/submission.service', () => ({
  SubmissionService: class SubmissionService {},
}));

import { WorkflowQueueHandler } from './workflow-queue.handler';

describe('WorkflowQueueHandler', () => {
  // The transaction callback gets its own client, distinct from `this.prisma`,
  // so a read that escapes the locked transaction is detectable.
  const aiWorkflowRunMock = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    createManyAndReturn: jest.fn(),
  };
  const txMock = {
    aiWorkflowRun: aiWorkflowRunMock,
    $executeRaw: jest.fn(),
  };
  const prismaMock = {
    aiWorkflowRun: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      createManyAndReturn: jest.fn(),
    },
    aiWorkflow: { findMany: jest.fn() },
    submission: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const giteaServiceMock = { runDispatchWorkflow: jest.fn() };
  const eventBusServiceMock = { publish: jest.fn(), sendEmail: jest.fn() };
  const aiReviewerDecisionMakerMock = {
    evaluateSubmission: jest.fn(),
    markDecisionError: jest.fn(),
  };
  const submissionServiceMock = {
    ensurePendingReviewsForSubmission: jest.fn(),
  };
  const challengeApiServiceMock = { getChallengeDetail: jest.fn() };

  let handler: WorkflowQueueHandler;

  const buildHandler = (): WorkflowQueueHandler =>
    new WorkflowQueueHandler(
      prismaMock as any,
      {} as any,
      challengeApiServiceMock as any,
      {} as any,
      giteaServiceMock as any,
      eventBusServiceMock as any,
      aiReviewerDecisionMakerMock as any,
      submissionServiceMock as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    // Run the transaction callback against the transaction client.
    prismaMock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(txMock),
    );
    aiReviewerDecisionMakerMock.evaluateSubmission.mockResolvedValue({
      status: 'PENDING',
    });
    prismaMock.submission.findUnique.mockResolvedValue(null);
    handler = buildHandler();
  });

  describe('reconcileTimedOutWorkflowRun', () => {
    const timedOutRun = (overrides: Record<string, unknown> = {}) => ({
      id: 'run-1',
      workflowId: 'workflow-1',
      submissionId: 'submission-1',
      gitRunId: '42',
      status: 'TIMEOUT',
      score: null,
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      workflow: { id: 'workflow-1', name: 'AI Reviewer' },
      _count: { items: 0 },
      ...overrides,
    });

    it('promotes a timed out run to SUCCESS when a score was reported', async () => {
      aiWorkflowRunMock.findUnique.mockResolvedValue(
        timedOutRun({ score: 85 }),
      );
      aiWorkflowRunMock.update.mockResolvedValue({
        ...timedOutRun({ score: 85 }),
        status: 'SUCCESS',
      });

      const completedAt = new Date('2026-02-02T10:00:00.000Z');
      const result = await handler.reconcileTimedOutWorkflowRun('run-1', {
        completedAt,
      });

      expect(result).toBe(true);
      expect(aiWorkflowRunMock.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { status: 'SUCCESS', completedAt },
        include: { workflow: true },
      });
      expect(
        aiReviewerDecisionMakerMock.evaluateSubmission,
      ).toHaveBeenCalledWith('submission-1');
    });

    it('promotes a timed out run to SUCCESS when run items were reported', async () => {
      aiWorkflowRunMock.findUnique.mockResolvedValue(
        timedOutRun({ _count: { items: 3 } }),
      );
      aiWorkflowRunMock.update.mockResolvedValue({
        ...timedOutRun({ _count: { items: 3 } }),
        status: 'SUCCESS',
      });

      await expect(handler.reconcileTimedOutWorkflowRun('run-1')).resolves.toBe(
        true,
      );
      expect(aiWorkflowRunMock.update).toHaveBeenCalled();
    });

    it('promotes a timed out run to SUCCESS on a late successful webhook', async () => {
      aiWorkflowRunMock.findUnique.mockResolvedValue(timedOutRun());
      aiWorkflowRunMock.update.mockResolvedValue({
        ...timedOutRun(),
        status: 'SUCCESS',
      });

      await expect(
        handler.reconcileTimedOutWorkflowRun('run-1', {
          conclusion: 'SUCCESS',
        }),
      ).resolves.toBe(true);
    });

    it('reconciles a run patched straight from TIMEOUT to SUCCESS', async () => {
      aiWorkflowRunMock.findUnique.mockResolvedValue(
        timedOutRun({ status: 'SUCCESS', score: 90 }),
      );
      aiWorkflowRunMock.update.mockResolvedValue(
        timedOutRun({ status: 'SUCCESS', score: 90 }),
      );

      await expect(
        handler.reconcileTimedOutWorkflowRun('run-1', {
          previousStatus: 'TIMEOUT',
        }),
      ).resolves.toBe(true);
    });

    it('leaves a timed out run alone when there are no results', async () => {
      aiWorkflowRunMock.findUnique.mockResolvedValue(timedOutRun());

      await expect(handler.reconcileTimedOutWorkflowRun('run-1')).resolves.toBe(
        false,
      );
      expect(aiWorkflowRunMock.update).not.toHaveBeenCalled();
      expect(
        aiReviewerDecisionMakerMock.evaluateSubmission,
      ).not.toHaveBeenCalled();
    });

    it('does nothing for a run that never timed out', async () => {
      aiWorkflowRunMock.findUnique.mockResolvedValue(
        timedOutRun({ status: 'FAILURE', score: 10 }),
      );

      await expect(handler.reconcileTimedOutWorkflowRun('run-1')).resolves.toBe(
        false,
      );
      expect(aiWorkflowRunMock.update).not.toHaveBeenCalled();
    });

    it('does nothing for a missing run', async () => {
      aiWorkflowRunMock.findUnique.mockResolvedValue(null);

      await expect(handler.reconcileTimedOutWorkflowRun('run-1')).resolves.toBe(
        false,
      );
    });
  });

  describe('queueWorkflowRuns', () => {
    beforeEach(() => {
      process.env.DISPATCH_AI_REVIEW_WORKFLOWS = 'false';
    });

    afterEach(() => {
      delete process.env.DISPATCH_AI_REVIEW_WORKFLOWS;
    });

    it('queues only the workflows without an existing run when onlyMissing is set', async () => {
      prismaMock.aiWorkflow.findMany.mockResolvedValue([
        { id: 'workflow-1' },
        { id: 'workflow-2' },
      ]);
      aiWorkflowRunMock.findMany.mockResolvedValue([
        { workflowId: 'workflow-1' },
      ]);
      aiWorkflowRunMock.createManyAndReturn.mockResolvedValue([
        { id: 'run-2', workflowId: 'workflow-2', workflow: {} },
      ]);

      const result = await handler.queueWorkflowRuns(
        [{ id: 'workflow-1' }, { id: 'workflow-2' }],
        'challenge-1',
        'submission-1',
        { onlyMissing: true },
      );

      expect(aiWorkflowRunMock.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            {
              workflowId: 'workflow-2',
              submissionId: 'submission-1',
              status: 'INIT',
              gitRunId: '',
            },
          ],
        }),
      );
      expect(result).toEqual({
        queuedRuns: [{ id: 'run-2', workflowId: 'workflow-2' }],
        skipped: false,
        reason: expect.any(String),
      });
    });

    it('checks the already-queued guard through the transaction client', async () => {
      prismaMock.aiWorkflow.findMany.mockResolvedValue([{ id: 'workflow-1' }]);
      aiWorkflowRunMock.findFirst.mockResolvedValue(null);
      aiWorkflowRunMock.createManyAndReturn.mockResolvedValue([
        { id: 'run-1', workflowId: 'workflow-1', workflow: {} },
      ]);

      const result = await handler.queueWorkflowRuns(
        [{ id: 'workflow-1' }],
        'challenge-1',
        'submission-1',
      );

      // The guard has to read on the connection holding the advisory lock.
      expect(aiWorkflowRunMock.findFirst).toHaveBeenCalledWith({
        where: { submissionId: 'submission-1' },
      });
      expect(prismaMock.aiWorkflowRun.findFirst).not.toHaveBeenCalled();
      expect(result.queuedRuns).toEqual([
        { id: 'run-1', workflowId: 'workflow-1' },
      ]);
    });

    it('skips queueing when the submission already has runs', async () => {
      prismaMock.aiWorkflow.findMany.mockResolvedValue([{ id: 'workflow-1' }]);
      aiWorkflowRunMock.findFirst.mockResolvedValue({ id: 'run-1' });

      const result = await handler.queueWorkflowRuns(
        [{ id: 'workflow-1' }],
        'challenge-1',
        'submission-1',
      );

      expect(aiWorkflowRunMock.createManyAndReturn).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
    });

    it('skips queueing when every workflow already has a run', async () => {
      prismaMock.aiWorkflow.findMany.mockResolvedValue([{ id: 'workflow-1' }]);
      aiWorkflowRunMock.findMany.mockResolvedValue([
        { workflowId: 'workflow-1' },
      ]);

      const result = await handler.queueWorkflowRuns(
        [{ id: 'workflow-1' }],
        'challenge-1',
        'submission-1',
        { onlyMissing: true },
      );

      expect(aiWorkflowRunMock.createManyAndReturn).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
      expect(result.queuedRuns).toEqual([]);
    });
  });
});
