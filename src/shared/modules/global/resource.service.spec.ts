import { ResourceApiService } from './resource.service';
import { HttpService } from '@nestjs/axios';
import { M2MService } from './m2m.service';
import { of } from 'rxjs';
import { AxiosResponse } from 'axios';
import { ResourceInfo } from 'src/shared/models/ResourceInfo.model';

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
});
