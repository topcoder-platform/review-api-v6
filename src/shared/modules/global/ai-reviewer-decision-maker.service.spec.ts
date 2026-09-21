import { AiReviewDecisionStatus, AiReviewMode } from '@prisma/client';
import { AiReviewerDecisionMakerService } from './ai-reviewer-decision-maker.service';

describe('AiReviewerDecisionMakerService.evaluateSubmission', () => {
  const submissionId = 'submission-1';
  const configId = 'config-1';
  const workflowId = 'workflow-1';

  const buildPrismaMock = () => ({
    submission: {
      findUnique: jest.fn().mockResolvedValue({
        id: submissionId,
        challengeId: 'challenge-1',
      }),
    },
    aiReviewConfig: {
      findFirst: jest.fn().mockResolvedValue({
        id: configId,
        minPassingThreshold: 75,
        autoFinalize: true,
        mode: AiReviewMode.AI_GATING,
        workflows: [
          {
            workflowId,
            weightPercent: 100,
            isGating: false,
            workflow: {
              scorecard: {
                minimumPassingScore: 80,
              },
            },
          },
        ],
      }),
    },
    aiWorkflowRun: {
      findMany: jest.fn(),
    },
    aiReviewDecision: {
      upsert: jest.fn().mockResolvedValue({ id: 'decision-1' }),
      update: jest.fn(),
    },
  });

  it('keeps decision pending when any configured run has TIMEOUT status', async () => {
    const prismaMock = buildPrismaMock();
    prismaMock.aiWorkflowRun.findMany.mockResolvedValue([
      {
        id: 'run-1',
        workflowId,
        status: 'TIMEOUT',
        score: null,
        startedAt: new Date('2026-09-21T00:00:00Z'),
        completedAt: new Date('2026-09-21T00:10:00Z'),
      },
    ]);

    prismaMock.aiReviewDecision.update.mockResolvedValue({
      id: 'decision-1',
      submissionId,
      configId,
      status: AiReviewDecisionStatus.PENDING,
      totalScore: null,
      submissionLocked: false,
      reason:
        'Awaiting successful completion of all configured AI workflow runs. One or more runs timed out and must be retriggered.',
      breakdown: null,
      isFinal: false,
      finalizedAt: null,
      createdAt: new Date('2026-09-21T00:00:00Z'),
      updatedAt: new Date('2026-09-21T00:00:00Z'),
    });

    const service = new AiReviewerDecisionMakerService(prismaMock as any);

    const decision = await service.evaluateSubmission(submissionId);

    expect(prismaMock.aiReviewDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AiReviewDecisionStatus.PENDING,
          reason: expect.stringContaining('timed out'),
        }),
      }),
    );
    expect(decision?.status).toBe(AiReviewDecisionStatus.PENDING);
  });
});
