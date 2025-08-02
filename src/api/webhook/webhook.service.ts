import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';
import {
  WebhookEventDto,
  WebhookResponseDto,
} from '../../dto/webhook-event.dto';

@Injectable()
export class WebhookService {
  private readonly logger = LoggerService.forRoot('WebhookService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {}

  async processWebhook(
    webhookEvent: WebhookEventDto,
  ): Promise<WebhookResponseDto> {
    try {
      this.logger.log({
        message: 'Processing GitHub webhook event',
        eventId: webhookEvent.eventId,
        event: webhookEvent.event,
        timestamp: new Date().toISOString(),
      });

      // Store webhook event in database
      const storedEvent = await this.prisma.gitWebhookLog.create({
        data: {
          eventId: webhookEvent.eventId,
          event: webhookEvent.event,
          eventPayload: webhookEvent.eventPayload,
        },
      });

      this.logger.log({
        message: 'Successfully stored webhook event',
        eventId: webhookEvent.eventId,
        event: webhookEvent.event,
        storedId: storedEvent.id,
        createdAt: storedEvent.createdAt,
      });

      // Future extensibility: Add event-specific handlers here
      this.handleEventSpecificProcessing(
        webhookEvent.event,
        webhookEvent.eventPayload,
      );

      return {
        success: true,
        message: 'Webhook processed successfully',
      };
    } catch (error) {
      this.logger.error({
        message: 'Failed to process webhook event',
        eventId: webhookEvent.eventId,
        event: webhookEvent.event,
        error: error.message,
        stack: error.stack,
      });

      // Handle Prisma errors with the existing error service
      if (error.code) {
        this.prismaErrorService.handleError(error);
      }

      throw error;
    }
  }

  /**
   * Placeholder for future event-specific processing logic
   * This method can be extended to handle different GitHub events differently
   */
  private handleEventSpecificProcessing(event: string, payload: any): void {
    this.logger.log({
      message: 'Event-specific processing placeholder',
      event,
      payloadSize: JSON.stringify(payload).length,
    });

    // Future implementation examples:
    // switch (event) {
    //   case 'push':
    //     await this.handlePushEvent(payload);
    //     break;
    //   case 'pull_request':
    //     await this.handlePullRequestEvent(payload);
    //     break;
    //   case 'issues':
    //     await this.handleIssuesEvent(payload);
    //     break;
    //   default:
    //     this.logger.log(`No specific handler for event type: ${event}`);
    // }
  }

  /**
   * Get webhook logs with pagination and filtering
   * This method provides basic querying capabilities for webhook events
   */
  async getWebhookLogs(options: {
    eventId?: string;
    event?: string;
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  }) {
    try {
      const {
        eventId,
        event,
        limit = 50,
        offset = 0,
        startDate,
        endDate,
      } = options;

      const where: any = {};

      if (eventId) {
        where.eventId = eventId;
      }

      if (event) {
        where.event = event;
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = startDate;
        }
        if (endDate) {
          where.createdAt.lte = endDate;
        }
      }

      const [logs, total] = await this.prisma.$transaction([
        this.prisma.gitWebhookLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.gitWebhookLog.count({ where }),
      ]);

      return {
        logs,
        total,
        limit,
        offset,
      };
    } catch (error) {
      this.logger.error({
        message: 'Failed to retrieve webhook logs',
        error: error.message,
        options,
      });

      if (error.code) {
        this.prismaErrorService.handleError(error);
      }

      throw error;
    }
  }
}
