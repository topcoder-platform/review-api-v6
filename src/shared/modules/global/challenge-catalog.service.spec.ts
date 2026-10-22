import { of } from 'rxjs';
import { ChallengeCatalogService } from './challenge-catalog.service';

describe('ChallengeCatalogService public catalog loading', () => {
  const httpServiceMock = { get: jest.fn() } as any;
  let service: ChallengeCatalogService;

  beforeEach(() => {
    jest.resetAllMocks();
    httpServiceMock.get.mockImplementation((url: string) =>
      of({
        data: url.endsWith('/challenge-types')
          ? [{ id: 'type-1', name: 'Marathon Match' }]
          : [{ id: 'track-1', name: 'Data Science' }],
      }),
    );
    service = new ChallengeCatalogService(httpServiceMock);
  });

  it('requests challenge types and tracks without an Authorization header', async () => {
    await service.onModuleInit();

    expect(httpServiceMock.get).toHaveBeenCalledTimes(2);
    for (const [url, options] of httpServiceMock.get.mock.calls) {
      expect(url).toMatch(/\/v6\/challenge-(types|tracks)$/);
      expect(options?.headers?.Authorization).toBeUndefined();
    }
    expect(service.getTypeIdByName('marathon match')).toBe('type-1');
    expect(service.getTrackIdByName('Data Science')).toBe('track-1');
  });
});
