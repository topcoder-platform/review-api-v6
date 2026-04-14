import { ResourceApiService } from './resource.service';
import { HttpService } from '@nestjs/axios';
import { M2MService } from './m2m.service';
import { of } from 'rxjs';
import { AxiosResponse } from 'axios';
import { ResourceInfo } from 'src/shared/models/ResourceInfo.model';
import { CommonConfig } from 'src/shared/config/common.config';

describe('ResourceApiService', () => {
  let httpService: { get: jest.Mock };
  let m2mService: { getM2MToken: jest.Mock };
  let service: ResourceApiService;

  const createResponse = (
    data: ResourceInfo[],
    headers: Record<string, string>,
  ): AxiosResponse<ResourceInfo[]> =>
    ({
      data,
      headers,
      status: 200,
      statusText: 'OK',
      config: {},
    }) as AxiosResponse<ResourceInfo[]>;

  const buildResource = (id: string): ResourceInfo => ({
    id,
    challengeId: 'challenge',
    memberId: '123',
    memberHandle: `handle-${id}`,
    roleId: 'role',
    createdBy: 'tc',
    created: new Date().toISOString(),
  });

  beforeEach(() => {
    httpService = { get: jest.fn() };
    m2mService = { getM2MToken: jest.fn().mockResolvedValue('token') };
    service = new ResourceApiService(
      m2mService as unknown as M2MService,
      httpService as unknown as HttpService,
    );
  });

  it('aggregates resources across multiple pages', async () => {
    const firstPage = [buildResource('r1')];
    const secondPage = [buildResource('r2')];

    httpService.get
      .mockReturnValueOnce(
        of(createResponse(firstPage, { 'x-total-pages': '2' })),
      )
      .mockReturnValueOnce(of(createResponse(secondPage, {})));

    const result = await service.getResources({ memberId: '123' });

    expect(result).toEqual([...firstPage, ...secondPage]);
    expect(httpService.get).toHaveBeenCalledTimes(2);
    expect(httpService.get.mock.calls[0][0]).toContain('page=1');
    expect(httpService.get.mock.calls[1][0]).toContain('page=2');
    expect(httpService.get.mock.calls[0][0]).toContain('perPage=1000');
  });

  it('stops pagination when the final page contains fewer results than the perPage size', async () => {
    const singlePage = [buildResource('r1')];
    httpService.get.mockReturnValueOnce(of(createResponse(singlePage, {})));

    const result = await service.getResources({ memberId: '123' });

    expect(result).toEqual(singlePage);
    expect(httpService.get).toHaveBeenCalledTimes(1);
  });

  it('validates a submitter handle against challenge resources', async () => {
    const submitterResource = {
      ...buildResource('submitter'),
      challengeId: 'challenge-1',
      memberId: '456',
      memberHandle: 'SubmitterOne',
      roleId: CommonConfig.roles.submitterRoleId,
    };

    jest.spyOn(service, 'getResources').mockResolvedValue([
      {
        ...buildResource('reviewer'),
        challengeId: 'challenge-1',
        memberId: '999',
        memberHandle: 'ReviewerOne',
        roleId: 'reviewer-role',
      },
      submitterResource,
    ]);

    const result = await service.validateSubmitterHandleRegistration(
      'challenge-1',
      'submitterone',
      '456',
    );

    expect(result).toEqual(submitterResource);
  });

  it('rejects submitter handle validation when the handle is not a submitter resource', async () => {
    jest.spyOn(service, 'getResources').mockResolvedValue([
      {
        ...buildResource('submitter'),
        challengeId: 'challenge-1',
        memberId: '456',
        memberHandle: 'AnotherSubmitter',
        roleId: CommonConfig.roles.submitterRoleId,
      },
    ]);

    await expect(
      service.validateSubmitterHandleRegistration(
        'challenge-1',
        'missingSubmitter',
      ),
    ).rejects.toThrow(
      'Handle missingSubmitter is not registered as a submitter for challenge challenge-1.',
    );
  });

  it('rejects submitter handle validation when the handle does not match the member id', async () => {
    jest.spyOn(service, 'getResources').mockResolvedValue([
      {
        ...buildResource('submitter'),
        challengeId: 'challenge-1',
        memberId: '456',
        memberHandle: 'SubmitterOne',
        roleId: CommonConfig.roles.submitterRoleId,
      },
    ]);

    await expect(
      service.validateSubmitterHandleRegistration(
        'challenge-1',
        'SubmitterOne',
        '123',
      ),
    ).rejects.toThrow(
      'Handle SubmitterOne does not match memberId 123 for challenge challenge-1.',
    );
  });
});
