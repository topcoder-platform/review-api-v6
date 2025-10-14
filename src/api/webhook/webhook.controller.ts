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
import { GiteaWebhookAuthGuard } from '../../shared/guards/gitea-webhook-auth.guard';
import { LoggerService } from '../../shared/modules/global/logger.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = LoggerService.forRoot('WebhookController');

  constructor(private readonly webhookService: WebhookService) {}

  @Post('gitea')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GiteaWebhookAuthGuard)
  @ApiOperation({
    summary: 'Gitea Webhook Endpoint',
    description:
      'Receives and processes Gitea webhook events with signature verification',
  })
  @ApiHeader({
    name: 'X-Gitea-Delivery',
    description: 'Gitea delivery UUID',
    required: true,
  })
  @ApiHeader({
    name: 'X-Gitea-Event',
    description: 'Gitea event type',
    required: true,
  })
  @ApiHeader({
    name: 'authorization',
    description: 'Authorization header for Gitea webhook',
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
  async handleGiteaWebhook(
    @Body() payload: any,
    @Headers('x-gitea-delivery') delivery: string,
    @Headers('x-gitea-event') event: string,
  ): Promise<WebhookResponseDto> {
    try {
      this.logger.log({
        message: 'Received Gitea webhook',
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
        message: 'Successfully processed Gitea webhook',
        delivery,
        event,
        success: result.success,
      });

      return result;
    } catch (error) {
      this.logger.error({
        message: 'Failed to process Gitea webhook',
        delivery,
        event,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }
}
