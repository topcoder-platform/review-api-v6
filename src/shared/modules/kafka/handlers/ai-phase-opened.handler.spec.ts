import { AiPhaseOpenedHandler } from './ai-phase-opened.handler';

describe('AiPhaseOpenedHandler', () => {
  const handlerRegistryMock = {
    registerHandler: jest.fn(),
  };
  const orchestratorMock = {
    orchestrateChallengePhaseOpened: jest.fn(),
  };
  let handler: AiPhaseOpenedHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new AiPhaseOpenedHandler(
      handlerRegistryMock as any,
      orchestratorMock as any,
    );
  });

  it('registers itself on module init', () => {
    handler.onModuleInit();

    expect(handlerRegistryMock.registerHandler).toHaveBeenCalledWith(
      'autopilot.ai.phase.opened',
      handler,
    );
  });

  it('processes valid messages and delegates orchestration', async () => {
    process.env.DISPATCH_AI_REVIEW_WORKFLOWS = 'true';
    await handler.handle({ payload: { challengeId: 'challenge-1' } });

    expect(orchestratorMock.orchestrateChallengePhaseOpened).toHaveBeenCalledWith(
      'challenge-1',
    );
  });

  it('skips when dispatch is disabled', async () => {
    process.env.DISPATCH_AI_REVIEW_WORKFLOWS = 'false';
    await handler.handle({ payload: { challengeId: 'challenge-1' } });

    expect(orchestratorMock.orchestrateChallengePhaseOpened).not.toHaveBeenCalled();
  });
});
