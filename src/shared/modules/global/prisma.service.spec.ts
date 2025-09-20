jest.mock('src/shared/request/requestStore', () => {
  return {
    getStore: jest.fn().mockReturnValue({ userId: 'member-default' }),
  };
});

import { __test__ } from './prisma.service';
import { getStore } from 'src/shared/request/requestStore';

describe('Prisma audit helpers', () => {
  const { addUserAuditField, auditField } = __test__;

  beforeEach(() => {
    (getStore as jest.Mock).mockReturnValue({ userId: 'member-default' });
  });

  it('sets createdBy and updatedBy on nested create during update operations', () => {
    const payload = {
      appealResponse: {
        create: [{}],
      },
    };

    addUserAuditField('appeal', auditField.updatedBy, payload);

    const nested = payload.appealResponse.create as Array<
      Record<string, unknown>
    >;

    expect(nested[0]).toMatchObject({
      createdBy: 'member-default',
      updatedBy: 'member-default',
    });
  });

  it('handles single-object nested create payloads', () => {
    const payload = {
      appealResponse: {
        create: {},
      },
    };

    (getStore as jest.Mock).mockReturnValue({ userId: 'member-override' });

    addUserAuditField('appeal', auditField.updatedBy, payload);

    const nested = payload.appealResponse.create as Record<string, unknown>;

    expect(nested).toMatchObject({
      createdBy: 'member-override',
      updatedBy: 'member-override',
    });
  });
});
