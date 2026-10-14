jest.mock('../../shared/modules/global/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../../shared/modules/global/prisma-error.service', () => ({
  PrismaErrorService: class PrismaErrorService {},
}));

jest.mock('src/shared/modules/global/workflow-queue.handler', () => ({
  WorkflowQueueHandler: class WorkflowQueueHandler {},
}));

import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  const prismaMock = {
    gitWebhookLog: { create: jest.fn() },
  };
  const workflowQueueHandlerMock = {
    handleWorkflowRunEvents: jest.fn(),
    handleWorkflowRunStatusEvent: jest.fn(),
  };

  let service: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.gitWebhookLog.create.mockResolvedValue({
      id: 'log-1',
      createdAt: new Date(),
    });
    service = new WebhookService(
      prismaMock as any,
      { handleError: jest.fn() } as any,
      workflowQueueHandlerMock as any,
    );
  });

  it('routes workflow_job events to the job event handler', async () => {
    const payload = { action: 'completed', workflow_job: { run_id: 1 } };

    await service.processWebhook({
      eventId: 'delivery-1',
      event: 'workflow_job',
      eventPayload: payload,
    });

    expect(
      workflowQueueHandlerMock.handleWorkflowRunEvents,
    ).toHaveBeenCalledWith(payload);
    expect(
      workflowQueueHandlerMock.handleWorkflowRunStatusEvent,
    ).not.toHaveBeenCalled();
  });

  it('routes workflow_run events to the run status handler', async () => {
    const payload = {
      action: 'completed',
      workflow_run: { id: 3860, conclusion: 'cancelled' },
    };

    await service.processWebhook({
      eventId: 'delivery-2',
      event: 'workflow_run',
      eventPayload: payload,
    });

    expect(
      workflowQueueHandlerMock.handleWorkflowRunStatusEvent,
    ).toHaveBeenCalledWith(payload);
    expect(
      workflowQueueHandlerMock.handleWorkflowRunEvents,
    ).not.toHaveBeenCalled();
  });
});
