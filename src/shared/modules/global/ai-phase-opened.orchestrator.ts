import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AiWorkflowQueueService } from './ai-workflow-queue.service';

@Injectable()
export class AiPhaseOpenedOrchestrator {
  private readonly logger = new Logger(AiPhaseOpenedOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiWorkflowQueueService: AiWorkflowQueueService,
  ) {}

  async orchestrateChallengePhaseOpened(challengeId: string): Promise<void> {
    if (!challengeId) {
      this.logger.warn('Skipping AI phase opened orchestration because challengeId is missing.');
      return;
    }

    try {
      const submissionIds = await this.getLatestContestSubmissionIds(challengeId);
      if (!submissionIds.length) {
        this.logger.log(
          `No latest contest submissions found for challenge ${challengeId}; skipping AI workflow queueing.`,
        );
        return;
      }

      this.logger.log(
        `Dispatching AI workflow queueing for ${submissionIds.length} latest submission(s) on challenge ${challengeId}.`,
      );

      for (const submissionId of submissionIds) {
        try {
          await this.aiWorkflowQueueService.queueWorkflowsForSubmission(
            submissionId,
            { aiPhaseOpened: true },
          );
        } catch (error) {
          const err = error as Error;
          this.logger.error(
            `Failed to queue AI workflows for submission ${submissionId} on challenge ${challengeId}: ${err.message}`,
            err.stack,
          );
        }
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to determine latest submissions for challenge ${challengeId}: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }

  private async getLatestContestSubmissionIds(
    challengeId: string,
  ): Promise<string[]> {
    const query = Prisma.sql`
      WITH latest_submissions AS (
        SELECT
          s."id",
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(s."memberId", s."id")
            ORDER BY
              s."submittedDate" DESC NULLS LAST,
              s."createdAt" DESC NULLS LAST,
              s."updatedAt" DESC NULLS LAST,
              s."id" DESC
          ) AS row_num
        FROM ${Prisma.sql`"submission"`} s
        WHERE s."challengeId" = ${challengeId}
          AND (s."status" = 'ACTIVE' OR s."status" IS NULL)
          AND s."virusScan" = TRUE
          AND (
            s."type" IS NULL
            OR UPPER((s."type")::text) = 'CONTEST_SUBMISSION'
          )
      )
      SELECT "id"
      FROM latest_submissions
      WHERE row_num = 1
    `;

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(query);
    return rows.map((row) => row.id).filter(Boolean);
  }
}
