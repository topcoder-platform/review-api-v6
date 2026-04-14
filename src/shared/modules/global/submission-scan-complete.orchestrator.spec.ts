jest.mock('./submission-base.service', () => ({
  SubmissionBaseService: class SubmissionBaseService {},
}));

jest.mock('./challenge.service', () => ({
  ChallengeApiService: class ChallengeApiService {},
}));

jest.mock('./workflow-queue.handler', () => ({
  WorkflowQueueHandler: class WorkflowQueueHandler {},
}));

jest.mock('./prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { SubmissionScanCompleteOrchestrator } from './submission-scan-complete.orchestrator';

describe('SubmissionScanCompleteOrchestrator', () => {
  const submissionBaseServiceMock = {
    getSubmissionById: jest.fn(),
  };
  const challengeApiServiceMock = {
    getChallengeDetail: jest.fn(),
  };
  const workflowQueueHandlerMock = {
    queueWorkflowRuns: jest.fn(),
  };
  const prismaMock = {
    aiReviewConfig: {
      findFirst: jest.fn(),
    },
  };

  let orchestrator: SubmissionScanCompleteOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new SubmissionScanCompleteOrchestrator(
      submissionBaseServiceMock as any,
      challengeApiServiceMock as any,
      workflowQueueHandlerMock as any,
      prismaMock as any,
    );
  });

  it('queues workflows from the active AI review config when scan completes', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-1',
      challengeId: 'challenge-1',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      workflows: [
        { workflowId: 'workflow-a' },
        { workflowId: 'workflow-a' },
        { workflowId: 'workflow-b' },
      ],
    });

    await orchestrator.orchestrateScanComplete('submission-1');

    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
    expect(workflowQueueHandlerMock.queueWorkflowRuns).toHaveBeenCalledWith(
      [{ id: 'workflow-a' }, { id: 'workflow-b' }],
      'challenge-1',
      'submission-1',
    );
  });

  it('falls back to challenge-linked workflows when no AI review config exists', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-2',
      challengeId: 'challenge-2',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue(null);
    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-2',
      workflows: [{ id: 'legacy-workflow-1' }, { id: 'legacy-workflow-2' }],
    });

    await orchestrator.orchestrateScanComplete('submission-2');

    expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
      'challenge-2',
    );
    expect(workflowQueueHandlerMock.queueWorkflowRuns).toHaveBeenCalledWith(
      [{ id: 'legacy-workflow-1' }, { id: 'legacy-workflow-2' }],
      'challenge-2',
      'submission-2',
    );
  });
});
