jest.mock('./prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('./ai-workflow-queue.service', () => ({
  AiWorkflowQueueService: class AiWorkflowQueueService {},
}));

import { AiPhaseOpenedOrchestrator } from './ai-phase-opened.orchestrator';

describe('AiPhaseOpenedOrchestrator', () => {
  const prismaMock = {
    $queryRaw: jest.fn(),
  };
  const aiWorkflowQueueServiceMock = {
    queueWorkflowsForSubmission: jest.fn(),
  };
  let orchestrator: AiPhaseOpenedOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new AiPhaseOpenedOrchestrator(
      prismaMock as any,
      aiWorkflowQueueServiceMock as any,
    );
  });

  it('queues workflows for each latest contest submission on challenge AI phase opened', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { id: 'submission-1' },
      { id: 'submission-2' },
    ]);

    await orchestrator.orchestrateChallengePhaseOpened('challenge-1');

    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(
      aiWorkflowQueueServiceMock.queueWorkflowsForSubmission,
    ).toHaveBeenCalledTimes(2);
    expect(
      aiWorkflowQueueServiceMock.queueWorkflowsForSubmission,
    ).toHaveBeenCalledWith('submission-1', { aiPhaseOpened: true });
    expect(
      aiWorkflowQueueServiceMock.queueWorkflowsForSubmission,
    ).toHaveBeenCalledWith('submission-2', { aiPhaseOpened: true });
  });

  it('skips orchestration when challengeId is missing', async () => {
    await orchestrator.orchestrateChallengePhaseOpened('');

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(
      aiWorkflowQueueServiceMock.queueWorkflowsForSubmission,
    ).not.toHaveBeenCalled();
  });

  it('skips when there are no latest submissions', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    await orchestrator.orchestrateChallengePhaseOpened('challenge-1');

    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(
      aiWorkflowQueueServiceMock.queueWorkflowsForSubmission,
    ).not.toHaveBeenCalled();
  });
});
