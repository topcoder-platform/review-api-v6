import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import {
  WebhookEventDto,
  WebhookResponseDto,
} from '../../dto/webhook-event.dto';
import { GitHubSignatureGuard } from '../../shared/guards/github-signature.guard';
import { LoggerService } from '../../shared/modules/global/logger.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = LoggerService.forRoot('WebhookController');

  constructor(private readonly webhookService: WebhookService) {}

  @Post('git')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GitHubSignatureGuard)
  @ApiOperation({
    summary: 'GitHub Webhook Endpoint',
    description:
      'Receives and processes GitHub webhook events with signature verification',
  })
  @ApiHeader({
    name: 'X-GitHub-Delivery',
    description: 'GitHub delivery UUID',
    required: true,
  })
  @ApiHeader({
    name: 'X-GitHub-Event',
    description: 'GitHub event type',
    required: true,
  })
  @ApiHeader({
    name: 'X-Hub-Signature-256',
    description: 'HMAC-SHA256 signature for request verification',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    type: WebhookResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Missing required headers or invalid payload',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Invalid signature',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error - Processing failed',
  })
  async handleGitHubWebhook(
    @Body() payload: any,
    @Headers('x-github-delivery') delivery: string,
    @Headers('x-github-event') event: string,
  ): Promise<WebhookResponseDto> {
    try {
      this.logger.log({
        message: 'Received GitHub webhook',
        delivery,
        event,
        timestamp: new Date().toISOString(),
      });

      // Create webhook event DTO
      const webhookEvent: WebhookEventDto = {
        eventId: delivery,
        event: event,
        eventPayload: payload,
      };

      // Process the webhook
      const result = await this.webhookService.processWebhook(webhookEvent);

      this.logger.log({
        message: 'Successfully processed GitHub webhook',
        delivery,
        event,
        success: result.success,
      });

      return result;
    } catch (error) {
      this.logger.error({
        message: 'Failed to process GitHub webhook',
        delivery,
        event,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }
}
