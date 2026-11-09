import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { JwtUser } from '../../shared/modules/global/jwt.service';
import { CreateUploadDto, SignUploadDto, UploadPurpose } from './uploads.dto';

export const UPLOAD_PART_SIZE = 10 * 1024 * 1024;
interface UploadGrant {
  purpose: UploadPurpose;
  bucket: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  userId: string;
  expires: number;
}

/** Server-owned destinations; the browser never chooses a bucket or an arbitrary key. */
const bucketVariables: Record<UploadPurpose, string> = {
  submission: 'SUBMISSION_DMZ_S3_BUCKET',
  cv: 'UPLOAD_ATTACHMENT_BUCKET',
  engagement: 'UPLOAD_ATTACHMENT_BUCKET',
  review: 'UPLOAD_ATTACHMENT_BUCKET',
  forum: 'UPLOAD_FORUM_BUCKET',
  project: 'UPLOAD_PROJECT_BUCKET',
  showcase: 'UPLOAD_SHOWCASE_BUCKET',
};

@Injectable()
export class UploadsService {
  private readonly s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    // Uppy 6.0 supplies the request body in the browser. Do not sign the SDK's
    // automatically generated checksum for an empty server-side body.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  private configuration(name: string): string {
    const value = process.env[name];
    if (!value)
      throw new ServiceUnavailableException(`Uploads require ${name}.`);
    return value;
  }

  private member(user?: JwtUser): string {
    if (!user?.userId || user.isMachine)
      throw new UnauthorizedException('A member login is required.');
    return String(user.userId);
  }

  private mac(scope: string, payload: string): Buffer {
    return createHmac('sha256', this.configuration('UPLOAD_SIGNING_SECRET'))
      .update(`${scope}:${payload}`)
      .digest();
  }

  private encode(scope: string, grant: UploadGrant): string {
    const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
    return `${payload}.${this.mac(scope, payload).toString('base64url')}`;
  }

  private decode(scope: string, token: string): UploadGrant {
    try {
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) throw new Error();
      const expected = this.mac(scope, payload);
      const received = Buffer.from(signature, 'base64url');
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      )
        throw new Error();
      return JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as UploadGrant;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ForbiddenException('Invalid upload grant.');
    }
  }

  create(input: CreateUploadDto, user: JwtUser) {
    const userId = this.member(user);
    const maxSize =
      input.purpose === 'cv'
        ? 8 * 1024 * 1024
        : input.purpose === 'forum'
          ? 25 * 1024 * 1024
          : 500 * 1024 * 1024;
    if (
      !Number.isInteger(input.size) ||
      input.size < 1 ||
      input.size > maxSize
    ) {
      throw new BadRequestException(
        `File must be between 1 and ${maxSize} bytes.`,
      );
    }
    if (input.purpose === 'submission' && !/\.zip$/i.test(input.filename)) {
      throw new BadRequestException('Submissions must be ZIP files.');
    }
    if (input.purpose === 'cv' && !/\.(pdf|docx)$/i.test(input.filename)) {
      throw new BadRequestException('CVs must be PDF or DOCX files.');
    }
    const variable = bucketVariables[input.purpose];
    if (!variable) throw new BadRequestException('Unsupported upload purpose.');
    const bucket = this.configuration(variable);
    const filename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    const context = input.contextId ? `${input.contextId}/` : '';
    const prefix =
      input.purpose === 'project'
        ? 'PROJECT_ATTACHMENTS'
        : input.purpose === 'showcase'
          ? 'project-showcase'
          : `uppy/${input.purpose}`;
    const key = `${prefix}/${context}${randomUUID()}/${filename}`;
    const grant: UploadGrant = {
      ...input,
      bucket,
      key,
      userId,
      expires: Date.now() + 24 * 60 * 60 * 1000,
    };
    const storageUrl = `https://s3.amazonaws.com/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    // Submission URLs must remain S3 URLs for the existing virus-scan pipeline.
    // Other files use an unguessable, durable read capability like the former
    // CDN handles. Buckets remain private; each read gets a short-lived S3 URL.
    const url =
      input.purpose === 'submission'
        ? storageUrl
        : input.purpose === 'showcase'
          ? `${this.configuration('UPLOAD_SHOWCASE_CDN_URL').replace(/\/$/, '')}/${key}`
          : `${this.configuration('UPLOAD_PUBLIC_API_URL').replace(/\/$/, '')}/files/${this.encode('download', grant)}`;
    return {
      token: this.encode('upload', grant),
      key,
      bucket,
      url,
      storageUrl,
      partSize: UPLOAD_PART_SIZE,
    };
  }

  async sign(input: SignUploadDto, user: JwtUser): Promise<{ url: string }> {
    const userId = this.member(user);
    const grant = this.decode('upload', input.token);
    if (
      grant.userId !== userId ||
      grant.expires < Date.now() ||
      grant.key !== input.key
    ) {
      throw new ForbiddenException(
        'Upload grant does not authorize this request.',
      );
    }
    const base = { Bucket: grant.bucket, Key: grant.key };
    let command;
    if (!input.uploadId) {
      if (input.partNumber !== undefined)
        throw new BadRequestException('Unexpected part number.');
      if (input.method === 'PUT') {
        command = new PutObjectCommand({
          ...base,
          ContentLength: grant.size,
          ContentType: grant.contentType,
        });
      } else if (input.method === 'POST') {
        command = new CreateMultipartUploadCommand({
          ...base,
          ContentType: grant.contentType,
        });
      } else throw new BadRequestException('Unsupported upload operation.');
    } else {
      const multipart = { ...base, UploadId: input.uploadId };
      if (input.method === 'PUT') {
        const part = input.partNumber;
        if (
          !part ||
          !Number.isInteger(part) ||
          part < 1 ||
          part > Math.ceil(grant.size / UPLOAD_PART_SIZE)
        ) {
          throw new BadRequestException('Invalid upload part.');
        }
        command = new UploadPartCommand({
          ...multipart,
          PartNumber: part,
          ContentLength: Math.min(
            UPLOAD_PART_SIZE,
            grant.size - (part - 1) * UPLOAD_PART_SIZE,
          ),
        });
      } else {
        if (input.partNumber !== undefined)
          throw new BadRequestException('Unexpected part number.');
        if (input.method === 'GET') command = new ListPartsCommand(multipart);
        else if (input.method === 'POST')
          command = new CompleteMultipartUploadCommand(multipart);
        else if (input.method === 'DELETE')
          command = new AbortMultipartUploadCommand(multipart);
        else throw new BadRequestException('Unsupported upload operation.');
      }
    }
    return {
      url: await getSignedUrl(this.s3, command, { expiresIn: 15 * 60 }),
    };
  }

  async download(token: string): Promise<string> {
    const grant = this.decode('download', token);
    // No capability can expose a competition submission, including a DMZ ZIP.
    if (grant.purpose === 'submission')
      throw new ForbiddenException('Use submission download authorization.');
    const inline = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf)$/.test(
      grant.contentType,
    );
    const officeDocument =
      grant.contentType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: grant.bucket,
        Key: grant.key,
        ResponseContentType: inline || officeDocument
          ? grant.contentType
          : 'application/octet-stream',
        ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(grant.filename)}`,
      }),
      { expiresIn: 300 },
    );
  }
}
