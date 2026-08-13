jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ReviewApplicationController } from './reviewApplication.controller';

describe('ReviewApplicationController applicant visibility forwarding', () => {
  const serviceMock = {
    listByOpportunity: jest.fn(),
  };
  const controller = new ReviewApplicationController(serviceMock as any);

  beforeEach(() => {
    jest.clearAllMocks();
    serviceMock.listByOpportunity.mockResolvedValue([]);
  });

  it('forwards an optional authenticated caller to the visibility-aware service', async () => {
    const authUser = {
      userId: 'group-member',
      roles: [],
      isMachine: false,
    };

    await controller.getByOpportunityId(
      { user: authUser } as any,
      'opportunity-1',
    );

    expect(serviceMock.listByOpportunity).toHaveBeenCalledWith(
      'opportunity-1',
      authUser,
    );
  });

  it('preserves anonymous visible-opportunity requests', async () => {
    await controller.getByOpportunityId({} as any, 'opportunity-public');

    expect(serviceMock.listByOpportunity).toHaveBeenCalledWith(
      'opportunity-public',
      undefined,
    );
  });
});
