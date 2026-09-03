jest.mock('./ai-workflow-queue.service', () => ({
  AiWorkflowQueueService: class AiWorkflowQueueService {},
}));

import { SubmissionScanCompleteOrchestrator } from './submission-scan-complete.orchestrator';

describe('SubmissionScanCompleteOrchestrator', () => {
  const aiWorkflowQueueServiceMock = {
    queueWorkflowsForSubmission: jest.fn(),
  };

  let orchestrator: SubmissionScanCompleteOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new SubmissionScanCompleteOrchestrator(
      aiWorkflowQueueServiceMock as any,
    );
  });

  it('delegates workflow queueing to the shared AI workflow queue service and asks for AI phase detection', async () => {
    await orchestrator.orchestrateScanComplete('submission-1');

    expect(aiWorkflowQueueServiceMock.queueWorkflowsForSubmission).toHaveBeenCalledWith(
      'submission-1',
      { detectAiPhaseOpened: true },
    );
  });
});
