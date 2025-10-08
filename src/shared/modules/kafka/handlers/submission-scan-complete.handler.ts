import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseEventHandler } from '../base-event.handler';
import { KafkaHandlerRegistry } from '../kafka-handler.registry';
import { LoggerService } from '../../global/logger.service';
import { PrismaService } from '../../global/prisma.service';
import { SubmissionScanCompleteOrchestrator } from '../../global/submission-scan-complete.orchestrator';
import { ChallengeApiService } from '../../global/challenge.service';
import { EventBusService } from '../../global/eventBus.service';
import { ResourcePrismaService } from '../../global/resource-prisma.service';

interface First2FinishSubmissionEventPayload {
  submissionId: string;
  challengeId: string;
  submissionUrl: string;
  memberHandle: string;
  memberId: string;
  submittedDate: string;
}

type SubmissionRecord = {
  id: string;
  challengeId: string | null;
  memberId: string | null;
  url: string | null;
  createdAt: Date;
};

@Injectable()
export class SubmissionScanCompleteHandler
  extends BaseEventHandler
  implements OnModuleInit
{
  private readonly topic = 'submission.scan.complete';

  constructor(
    private readonly handlerRegistry: KafkaHandlerRegistry,
    private readonly orchestrator: SubmissionScanCompleteOrchestrator,
    private readonly prisma: PrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly resourcePrisma: ResourcePrismaService,
    private readonly eventBusService: EventBusService,
  ) {
    super(LoggerService.forRoot('SubmissionScanCompleteHandler'));
  }

  onModuleInit() {
    this.handlerRegistry.registerHandler(this.topic, this);
    this.logger.log(`Registered handler for topic: ${this.topic}`);
  }

  getTopic(): string {
    return this.topic;
  }

  async handle(message: any): Promise<void> {
    try {
      this.logger.log({
        message: 'Processing Submission Scan Complete event',
        topic: this.topic,
        payload: message,
      });

      if (!this.validateMessage(message)) {
        this.logger.warn('Invalid message received');
        return;
      }

      this.logger.log('=== Submission Scan Complete Event ===');
      this.logger.log('Topic: ' + this.topic);
      this.logger.log('Payload: ' + JSON.stringify(message, null, 2));
      this.logger.log('==============================');

      if (!message.isInfected) {
        const submission = await this.updateSubmissionUrl(
          message.payload.submissionId,
          message.payload.url,
        );

        if (process.env.DISPATCH_AI_REVIEW_WORKFLOWS === 'true') {
          // delegate to orchestrator for further processing
          await this.orchestrator.orchestrateScanComplete(
            message.payload.submissionId,
          );
        } else {
          this.logger.log(
            'AI Review Workflows are disabled. Skipping orchestration.',
          );
        }

        if (submission) {
          await this.publishFirst2FinishEvent(submission);
          await this.publishTopgearTaskEvent(submission);
        }
      } else {
        this.logger.log(
          `Submission ${message.payload.submissionId} is infected, skipping further processing.`,
        );
      }

      this.logger.log('Submission Scan Complete event processed successfully');
    } catch (error) {
      this.logger.error(
        'Error processing Submission Scan Complete event',
        error,
      );
      throw error;
    }
  }

  private async updateSubmissionUrl(
    submissionId: string,
    url: string,
  ): Promise<SubmissionRecord | null> {
    if (!submissionId) {
      this.logger.warn(
        'Submission ID is missing in the scan complete message.',
      );
      return null;
    }

    if (!url) {
      this.logger.warn(
        `URL is missing in scan complete message for submission ${submissionId}.`,
      );
      return null;
    }

    try {
      const updated = await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          url,
          virusScan: true,
          updatedBy: 'SubmissionScanCompleteHandler',
        },
        select: {
          id: true,
          challengeId: true,
          memberId: true,
          url: true,
          createdAt: true,
        },
      });
      this.logger.log(
        `Updated submission ${submissionId} with scanned artifact URL.`,
      );
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to update submission ${submissionId} with scanned artifact URL`,
        error,
      );
      throw error;
    }
  }

  private async publishFirst2FinishEvent(
    submission: SubmissionRecord,
  ): Promise<void> {
    if (!submission.challengeId) {
      this.logger.warn(
        `Submission ${submission.id} missing challengeId. Skipping First2Finish event publish.`,
      );
      return;
    }

    const challenge = await this.challengeApiService.getChallengeDetail(
      submission.challengeId,
    );

    if (!this.isFirst2FinishChallenge(challenge?.type)) {
      this.logger.log(
        `Challenge ${submission.challengeId} is not First2Finish. Skipping event publish for submission ${submission.id}.`,
      );
      return;
    }

    if (!submission.url) {
      throw new Error(
        `Updated submission ${submission.id} does not contain a URL required for First2Finish event payload.`,
      );
    }

    if (!submission.memberId) {
      throw new Error(
        `Submission ${submission.id} missing memberId. Cannot publish First2Finish event.`,
      );
    }

    const memberHandle = await this.lookupMemberHandle(
      submission.challengeId,
      submission.memberId,
    );

    if (!memberHandle) {
      throw new Error(
        `Unable to locate member handle for member ${submission.memberId} on challenge ${submission.challengeId}.`,
      );
    }

    const submittedDate = submission.createdAt.toISOString();

    const payload: First2FinishSubmissionEventPayload = {
      submissionId: submission.id,
      challengeId: submission.challengeId,
      submissionUrl: submission.url,
      memberHandle,
      memberId: submission.memberId,
      submittedDate,
    };

    await this.eventBusService.publish(
      'first2finish.submission.received',
      payload,
    );

    this.logger.log(
      `Published first2finish.submission.received event for submission ${submission.id}.`,
    );
  }

  private isFirst2FinishChallenge(typeName?: string): boolean {
    return (typeName ?? '').trim().toLowerCase() === 'first2finish';
  }

  private async publishTopgearTaskEvent(
    submission: SubmissionRecord,
  ): Promise<void> {
    if (!submission.challengeId) {
      this.logger.warn(
        `Submission ${submission.id} missing challengeId. Skipping Topgear event publish.`,
      );
      return;
    }

    const challenge = await this.challengeApiService.getChallengeDetail(
      submission.challengeId,
    );

    if (!this.isTopgearTaskChallenge(challenge?.type)) {
      this.logger.log(
        `Challenge ${submission.challengeId} is not Topgear Task. Skipping event publish for submission ${submission.id}.`,
      );
      return;
    }

    if (!submission.url) {
      throw new Error(
        `Updated submission ${submission.id} does not contain a URL required for Topgear event payload.`,
      );
    }

    if (!submission.memberId) {
      throw new Error(
        `Submission ${submission.id} missing memberId. Cannot publish Topgear event.`,
      );
    }

    const memberHandle = await this.lookupMemberHandle(
      submission.challengeId,
      submission.memberId,
    );

    if (!memberHandle) {
      throw new Error(
        `Unable to locate member handle for member ${submission.memberId} on challenge ${submission.challengeId}.`,
      );
    }

    const submittedDate = submission.createdAt.toISOString();

    const payload: First2FinishSubmissionEventPayload = {
      submissionId: submission.id,
      challengeId: submission.challengeId,
      submissionUrl: submission.url,
      memberHandle,
      memberId: submission.memberId,
      submittedDate,
    };

    await this.eventBusService.publish('topgear.submission.received', payload);

    this.logger.log(
      `Published topgear.submission.received event for submission ${submission.id}.`,
    );
  }

  private isTopgearTaskChallenge(typeName?: string): boolean {
    return (typeName ?? '').trim().toLowerCase() === 'topgear task';
  }

  private async lookupMemberHandle(
    challengeId: string,
    memberId: string,
  ): Promise<string | null> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
      },
    });

    return resource?.memberHandle ?? null;
  }
}
