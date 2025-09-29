import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { LoggerService } from '../modules/global/logger.service';

@Injectable()
export class GiteaWebhookAuthGuard implements CanActivate {
  private readonly logger = LoggerService.forRoot('GiteaWebhookAuthGuard');

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const delivery = request.headers['x-gitea-delivery'] as string;
    const event = request.headers['x-gitea-event'] as string;
    const authHeader = request.headers['authorization'] as string;

    // Check if GITEA_WEBHOOK_AUTH is configured
    const auth = process.env.GITEA_WEBHOOK_AUTH;
    if (!auth) {
      this.logger.error(
        'GITEA_WEBHOOK_AUTH environment variable is not configured',
      );
      throw new InternalServerErrorException('Webhook auth not configured');
    }

    if (!delivery) {
      this.logger.error('Missing X-Gitea-Delivery header');
      throw new BadRequestException('Missing delivery header');
    }

    if (!event) {
      this.logger.error('Missing X-Gitea-Event header');
      throw new BadRequestException('Missing event header');
    }

    try {
      // Validate the authorization header
      if (!authHeader) {
        this.logger.error('Missing Authorization header');
        throw new BadRequestException('Missing authorization header');
      }

      if (authHeader !== `SecretKey ${auth}`) {
        this.logger.error('Invalid authorization header');
        throw new ForbiddenException('Invalid authorization');
      }

      this.logger.log(
        `Valid webhook authorization verified for delivery ${delivery}, event ${event}`,
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
