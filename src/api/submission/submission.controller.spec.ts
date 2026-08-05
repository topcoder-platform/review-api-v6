jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { SCOPES_KEY } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import { HttpStatus } from '@nestjs/common';
import { HEADERS_METADATA, REDIRECT_METADATA } from '@nestjs/common/constants';
import { SubmissionController } from './submission.controller';

describe('SubmissionController', () => {
  it('allows Marathon Match service scopes on validation upload', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      SubmissionController.prototype,
      'validationUploadSubmission',
    );
    const scopes = Reflect.getMetadata(SCOPES_KEY, descriptor?.value as object);

    expect(descriptor?.value).toBeDefined();
    expect(scopes).toEqual(
      expect.arrayContaining([
        Scope.CreateSubmission,
        Scope.UpdateMarathonMatch,
        Scope.AllMarathonMatch,
      ]),
    );
  });

  it('returns a non-cacheable temporary redirect to the signed download URL', async () => {
    const signedUrl = 'https://signed.example/submission.zip';
    const authUser = { userId: 'owner-user', isMachine: false };
    const service = {
      getSubmissionDownloadUrl: jest.fn().mockResolvedValue(signedUrl),
    };
    const controller = new SubmissionController(service as any);

    const result = await controller.downloadSubmission(
      { user: authUser } as any,
      'submission-123',
    );

    expect(service.getSubmissionDownloadUrl).toHaveBeenCalledWith(
      authUser,
      'submission-123',
    );
    expect(result).toEqual({ url: signedUrl, statusCode: HttpStatus.FOUND });

    const descriptor = Object.getOwnPropertyDescriptor(
      SubmissionController.prototype,
      'downloadSubmission',
    );
    expect(
      Reflect.getMetadata(REDIRECT_METADATA, descriptor?.value as object),
    ).toEqual({ url: '', statusCode: HttpStatus.FOUND });
    expect(
      Reflect.getMetadata(HEADERS_METADATA, descriptor?.value as object),
    ).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'private, no-store' },
      ]),
    );
  });

  it('returns a non-cacheable signed download URL without redirecting', async () => {
    const signedUrl = 'https://signed.example/submission.zip';
    const authUser = { userId: 'owner-user', isMachine: false };
    const service = {
      getSubmissionDownloadUrl: jest.fn().mockResolvedValue(signedUrl),
    };
    const controller = new SubmissionController(service as any);

    const result = await controller.getSubmissionDownloadUrl(
      { user: authUser } as any,
      'submission-123',
    );

    expect(service.getSubmissionDownloadUrl).toHaveBeenCalledWith(
      authUser,
      'submission-123',
    );
    expect(result).toEqual({ url: signedUrl });

    const descriptor = Object.getOwnPropertyDescriptor(
      SubmissionController.prototype,
      'getSubmissionDownloadUrl',
    );
    expect(
      Reflect.getMetadata(REDIRECT_METADATA, descriptor?.value as object),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(HEADERS_METADATA, descriptor?.value as object),
    ).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'private, no-store' },
      ]),
    );
  });
});
