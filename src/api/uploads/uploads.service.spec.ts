import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UPLOAD_PART_SIZE, UploadsService } from './uploads.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
}));
const signed = jest.mocked(getSignedUrl);
const member = { userId: '123', isMachine: false };
const file = {
  purpose: 'submission' as const,
  filename: 'solution.zip',
  contentType: 'application/zip',
  size: 15 * 1024 * 1024,
};

describe('Uppy S3 uploads', () => {
  let service: UploadsService;
  beforeEach(() => {
    Object.assign(process.env, {
      UPLOAD_SIGNING_SECRET: 'test-only-upload-secret',
      SUBMISSION_DMZ_S3_BUCKET: 'submission-dmz',
      UPLOAD_ATTACHMENT_BUCKET: 'attachments',
      UPLOAD_FORUM_BUCKET: 'forum-files',
      UPLOAD_PROJECT_BUCKET: 'project-files',
      UPLOAD_SHOWCASE_BUCKET: 'showcase-files',
      UPLOAD_SHOWCASE_CDN_URL: 'https://showcase.example',
      UPLOAD_PUBLIC_API_URL: 'https://api.example/v6/reviews/uploads',
    });
    service = new UploadsService();
    signed.mockClear();
  });

  it('keeps submissions in the DMZ and issues unique server-owned keys', () => {
    const one = service.create(file, member);
    expect(one.bucket).toBe('submission-dmz');
    expect(one.url).toMatch(
      /^https:\/\/s3.amazonaws.com\/submission-dmz\/uppy\/submission\//,
    );
    expect(one.key).not.toBe(service.create(file, member).key);
    expect(one.partSize).toBe(UPLOAD_PART_SIZE);
  });

  it('requires a member and limits ZIP and CV types and sizes', () => {
    expect(() => service.create(file, undefined as any)).toThrow(
      UnauthorizedException,
    );
    expect(() => service.create(file, { ...member, isMachine: true })).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      service.create({ ...file, filename: 'code.js' }, member),
    ).toThrow(BadRequestException);
    expect(() =>
      service.create(
        { ...file, purpose: 'cv', filename: 'cv.doc', size: 20 },
        member,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.create({ ...file, purpose: 'cv', filename: 'cv.pdf' }, member),
    ).toThrow(BadRequestException);
    expect(() => service.create({ ...file, size: 0 }, member)).toThrow(
      BadRequestException,
    );
  });

  it('rejects modified grants, other members, expired grants and arbitrary keys', async () => {
    const session = service.create(file, member);
    const request = {
      token: session.token,
      key: session.key,
      method: 'PUT' as const,
    };
    await expect(
      service.sign({ ...request, token: `${session.token}x` }, member),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.sign(request, { ...member, userId: '456' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.sign({ ...request, key: 'existing/private.zip' }, member),
    ).rejects.toThrow(ForbiddenException);
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    await expect(service.sign(request, member)).rejects.toThrow(
      ForbiddenException,
    );
    now.mockRestore();
    expect(signed).not.toHaveBeenCalled();
  });

  it('signs PUT and the full multipart lifecycle with bounded part sizes', async () => {
    const session = service.create(file, member);
    const request = {
      token: session.token,
      key: session.key,
      method: 'PUT' as const,
    };
    await service.sign(request, member);
    expect((signed.mock.calls[0][1] as any).input.ContentLength).toBe(
      file.size,
    );
    const cases = [
      { method: 'POST', command: 'CreateMultipartUploadCommand' },
      {
        method: 'PUT',
        uploadId: 'multipart-id',
        partNumber: 1,
        command: 'UploadPartCommand',
      },
      {
        method: 'PUT',
        uploadId: 'multipart-id',
        partNumber: 2,
        command: 'UploadPartCommand',
      },
      { method: 'GET', uploadId: 'multipart-id', command: 'ListPartsCommand' },
      {
        method: 'POST',
        uploadId: 'multipart-id',
        command: 'CompleteMultipartUploadCommand',
      },
      {
        method: 'DELETE',
        uploadId: 'multipart-id',
        command: 'AbortMultipartUploadCommand',
      },
    ];
    for (const { command, ...operation } of cases) {
      await service.sign({ ...request, ...operation } as any, member);
      expect(signed.mock.calls.at(-1)?.[1].constructor.name).toBe(command);
    }
    expect((signed.mock.calls[2][1] as any).input.ContentLength).toBe(
      UPLOAD_PART_SIZE,
    );
    expect((signed.mock.calls[3][1] as any).input.ContentLength).toBe(
      5 * 1024 * 1024,
    );
    await expect(
      service.sign({ ...request, method: 'DELETE' }, member),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.sign({ ...request, uploadId: 'id', partNumber: 3 }, member),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.sign({ ...request, method: 'GET' }, member),
    ).rejects.toThrow(BadRequestException);
  });

  it('provides durable read capabilities without allowing them to authorize writes', async () => {
    const session = service.create(
      {
        ...file,
        purpose: 'cv',
        filename: 'cv.pdf',
        contentType: 'application/pdf',
        size: 100,
      },
      member,
    );
    const token = session.url.split('/files/')[1];
    expect(session.bucket).toBe('attachments');
    await expect(service.download(token)).resolves.toBe(
      'https://signed.example/file',
    );
    expect(
      (signed.mock.calls[0][1] as any).input.ResponseContentDisposition,
    ).toMatch(/^inline;/);
    await expect(
      service.sign({ token, key: session.key, method: 'PUT' }, member),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.download(session.token)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('forces active content to download and preserves each destination', async () => {
    for (const [purpose, bucket] of [
      ['forum', 'forum-files'],
      ['project', 'project-files'],
      ['showcase', 'showcase-files'],
      ['engagement', 'attachments'],
      ['review', 'attachments'],
    ] as const) {
      const session = service.create(
        {
          ...file,
          purpose,
          filename: 'notes.html',
          contentType: 'text/html',
          size: 100,
        },
        member,
      );
      expect(session.bucket).toBe(bucket);
      if (purpose !== 'showcase') {
        await service.download(session.url.split('/files/')[1]);
        expect(
          (signed.mock.calls.at(-1)?.[1] as any).input
            .ResponseContentDisposition,
        ).toMatch(/^attachment;/);
      }
    }
  });
});
