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
    isPhaseOpen: jest.fn(),
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
      template: { disabled: false },
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

  it('queues workflows during AI phase opened event even when instantReview is disabled', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-5',
      challengeId: 'challenge-5',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      instantReview: false,
      template: { disabled: false },
      workflows: [
        { workflowId: 'workflow-c' },
      ],
    });

    await service.queueWorkflowsForSubmission('submission-5', {
      aiPhaseOpened: true,
    });

    expect(workflowQueueHandlerMock.queueWorkflowRuns).toHaveBeenCalledWith(
      [{ id: 'workflow-c' }],
      'challenge-5',
      'submission-5',
    );
  });

  it('queues workflows when detection finds an AI phase already open', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-7',
      challengeId: 'challenge-7',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      instantReview: false,
      template: { disabled: false },
      workflows: [{ workflowId: 'workflow-d' }],
    });
    challengeApiServiceMock.isPhaseOpen.mockResolvedValue(true);

    await service.queueWorkflowsForSubmission('submission-7', {
      detectAiPhaseOpened: true,
    });

    expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenCalledWith(
      'challenge-7',
      ['AI Screening', 'AI Review'],
    );
    expect(workflowQueueHandlerMock.queueWorkflowRuns).toHaveBeenCalledWith(
      [{ id: 'workflow-d' }],
      'challenge-7',
      'submission-7',
    );
  });

  it('does not queue workflows when detection finds no AI phase open', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-8',
      challengeId: 'challenge-8',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      instantReview: false,
      template: { disabled: false },
      workflows: [{ workflowId: 'workflow-d' }],
    });
    challengeApiServiceMock.isPhaseOpen.mockResolvedValue(false);

    await service.queueWorkflowsForSubmission('submission-8', {
      detectAiPhaseOpened: true,
    });

    expect(workflowQueueHandlerMock.queueWorkflowRuns).not.toHaveBeenCalled();
  });

  it('does not queue workflows when AI phase detection fails', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-9',
      challengeId: 'challenge-9',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      instantReview: false,
      template: { disabled: false },
      workflows: [{ workflowId: 'workflow-d' }],
    });
    challengeApiServiceMock.isPhaseOpen.mockRejectedValue(
      new Error('challenge lookup failed'),
    );

    await service.queueWorkflowsForSubmission('submission-9', {
      detectAiPhaseOpened: true,
    });

    expect(workflowQueueHandlerMock.queueWorkflowRuns).not.toHaveBeenCalled();
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

    expect(challengeApiServiceMock.isPhaseOpen).not.toHaveBeenCalled();
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
  it('skips queueing when active AI review config template is disabled', async () => {
    submissionBaseServiceMock.getSubmissionById.mockResolvedValue({
      id: 'submission-6',
      challengeId: 'challenge-6',
    });
    prismaMock.aiReviewConfig.findFirst.mockResolvedValue({
      instantReview: true,
      template: { disabled: true },
      workflows: [{ workflowId: 'workflow-a' }],
    });
    await service.queueWorkflowsForSubmission('submission-6');
    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
    expect(workflowQueueHandlerMock.queueWorkflowRuns).not.toHaveBeenCalled();
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
