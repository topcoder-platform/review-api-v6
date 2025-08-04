import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { LoggerService } from '../modules/global/logger.service';

@Injectable()
export class GiteaSignatureGuard implements CanActivate {
  private readonly logger = LoggerService.forRoot('GiteaSignatureGuard');

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const signature = request.headers['x-hub-signature-256'] as string;
    const delivery = request.headers['x-gitea-delivery'] as string;
    const event = request.headers['x-gitea-event'] as string;

    // Check if GITEA_WEBHOOK_SECRET is configured
    const secret = process.env.GITEA_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error(
        'GITEA_WEBHOOK_SECRET environment variable is not configured',
      );
      throw new InternalServerErrorException('Webhook secret not configured');
    }

    // Validate required headers
    if (!signature) {
      this.logger.error('Missing X-Hub-Signature-256 header');
      throw new BadRequestException('Missing signature header');
    }

    if (!delivery) {
      this.logger.error('Missing X-Gitea-Delivery header');
      throw new BadRequestException('Missing delivery header');
    }

    if (!event) {
      this.logger.error('Missing X-Gitea-Event header');
      throw new BadRequestException('Missing event header');
    }

    // Validate signature format
    if (!signature.startsWith('sha256=')) {
      this.logger.error('Invalid signature format');
      throw new BadRequestException('Invalid signature format');
    }

    try {
      // Get the raw body for signature verification
      const payload = request.body;
      let bodyString: string;

      if (typeof payload === 'string') {
        bodyString = payload;
      } else if (Buffer.isBuffer(payload)) {
        bodyString = payload.toString('utf8');
      } else {
        bodyString = JSON.stringify(payload);
      }

      // Compute HMAC-SHA256 signature
      const computedSignature = crypto
        .createHmac('sha256', secret)
        .update(bodyString, 'utf8')
        .digest('hex');

      const expectedSignature = `sha256=${computedSignature}`;

      // Extract the signature hash from the header
      const providedSignature = signature;

      // Perform timing-safe comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(providedSignature, 'utf8'),
      );

      if (!isValid) {
        this.logger.error(`Invalid webhook signature for delivery ${delivery}`);
        throw new ForbiddenException('Invalid signature');
      }

      this.logger.log(
        `Valid webhook signature verified for delivery ${delivery}, event ${event}`,
      );
      return true;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(`Error validating webhook signature: ${error.message}`);
      throw new InternalServerErrorException('Signature validation failed');
    }
  }
}
