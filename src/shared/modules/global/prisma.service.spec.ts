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

  it('records the machine client identity on every audited model', () => {
    (getStore as jest.Mock).mockReturnValue({
      userId: 'm2m-client-id@clients',
    });

    const workflow: Record<string, unknown> = { name: 'workflow' };
    addUserAuditField('aiWorkflow', auditField.createdBy, workflow);
    addUserAuditField('aiWorkflow', auditField.updatedBy, workflow);

    const appeal: Record<string, unknown> = {};
    addUserAuditField('appeal', auditField.updatedBy, appeal);

    expect(workflow).toMatchObject({
      createdBy: 'm2m-client-id@clients',
      updatedBy: 'm2m-client-id@clients',
    });
    expect(appeal).toEqual({ updatedBy: 'm2m-client-id@clients' });
  });

  it('replaces an actor the caller passed explicitly', () => {
    (getStore as jest.Mock).mockReturnValue({
      userId: 'm2m-client-id@clients',
    });
    const payload: Record<string, unknown> = { createdBy: 'machine-token' };

    addUserAuditField('submission', auditField.createdBy, payload);

    expect(payload).toEqual({ createdBy: 'm2m-client-id@clients' });
  });

  it('leaves audit fields untouched outside a request', () => {
    (getStore as jest.Mock).mockReturnValue({});
    const payload: Record<string, unknown> = { updatedBy: 'KafkaHandler' };

    addUserAuditField('submission', auditField.updatedBy, payload);

    expect(payload).toEqual({ updatedBy: 'KafkaHandler' });
  });
});
