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

import { AiWorkflowQueueService } from './ai-workflow-queue.service';

describe('AiWorkflowQueueService', () => {
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

  let service: AiWorkflowQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiWorkflowQueueService(
      submissionBaseServiceMock as any,
      challengeApiServiceMock as any,
      workflowQueueHandlerMock as any,
      prismaMock as any,
    );
  });

  it('queues workflows from active AI review config when instantReview is enabled', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-1',
      challengeId: 'challenge-1',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      instantReview: true,
      workflows: [
        { workflowId: 'workflow-a' },
        { workflowId: 'workflow-a' },
        { workflowId: 'workflow-b' },
      ],
    });

    await service.queueWorkflowsForSubmission('submission-1');

    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
    expect(workflowQueueHandlerMock.queueWorkflowRuns).toHaveBeenCalledWith(
      [{ id: 'workflow-a' }, { id: 'workflow-b' }],
      'challenge-1',
      'submission-1',
    );
  });

  it('does not queue workflows when instantReview is disabled on active AI review config', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-2',
      challengeId: 'challenge-2',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      instantReview: false,
      workflows: [{ workflowId: 'workflow-a' }],
    });

    await service.queueWorkflowsForSubmission('submission-2');

    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
    expect(workflowQueueHandlerMock.queueWorkflowRuns).not.toHaveBeenCalled();
  });

  it('falls back to challenge-linked workflows when no AI review config exists', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-3',
      challengeId: 'challenge-3',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue(null);
    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-3',
      workflows: [{ id: 'legacy-workflow-1' }, { id: 'legacy-workflow-2' }],
    });

    await service.queueWorkflowsForSubmission('submission-3');

    expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
      'challenge-3',
    );
    expect(workflowQueueHandlerMock.queueWorkflowRuns).toHaveBeenCalledWith(
      [{ id: 'legacy-workflow-1' }, { id: 'legacy-workflow-2' }],
      'challenge-3',
      'submission-3',
    );
  });

  it('skips queueing when submission challengeId is missing', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-4',
      challengeId: null,
    });

    await service.queueWorkflowsForSubmission('submission-4');

    expect(workflowQueueHandlerMock.queueWorkflowRuns).not.toHaveBeenCalled();
  });
});
