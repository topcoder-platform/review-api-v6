import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { GiteaService, ActionDispatchWorkflowResponse } from './gitea.service';
import { PrismaService } from './prisma.service';
import { aiWorkflow, aiWorkflowRun } from '@prisma/client';
import { EventBusSendEmailPayload, EventBusService } from './eventBus.service';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengePrismaService } from './challenge-prisma.service';
import { MemberPrismaService } from './member-prisma.service';
import { AiReviewerDecisionMakerService } from './ai-reviewer-decision-maker.service';
import { ChallengeApiService, PhaseData } from './challenge.service';
import { SubmissionService } from 'src/api/submission/submission.service';

// A helper to generate a 32-bit integer hash from a string
function stringToHash(string: string): number {
  let hash = 0;
  if (string.length === 0) return hash;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

const DEFAULT_AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS = 10000;
const MIN_AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS = 1000;

const AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS = (() => {
  const configured = Number(
    process.env.AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS ??
      DEFAULT_AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS,
  );
  if (!Number.isFinite(configured)) {
    return DEFAULT_AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS;
  }
  const normalized = Math.floor(configured);
  if (normalized < MIN_AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS) {
    return DEFAULT_AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS;
  }
  return normalized;
})();

@Injectable()
export class WorkflowQueueHandler {
  private readonly logger: Logger = new Logger(WorkflowQueueHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengesPrisma: ChallengePrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly membersPrisma: MemberPrismaService,
    private readonly giteaService: GiteaService,
    private readonly eventBusService: EventBusService,
    private readonly aiReviewerDecisionMaker: AiReviewerDecisionMakerService,
    private readonly submissionService: SubmissionService,
  ) {}

  get isDispatchEnabled(): boolean {
    return process.env.DISPATCH_AI_REVIEW_WORKFLOWS === 'true';
  }

  get maxWorkflowRetries(): number {
    const configured = Number(process.env.AI_WORKFLOW_MAX_RETRIES ?? 1);
    if (!Number.isFinite(configured) || configured < 0) {
      return 0;
    }

    return Math.floor(configured);
  }

  get defaultWorkflowTimeoutSeconds(): number {
    const configured = Number(process.env.AI_WORKFLOW_TIMEOUT_SECONDS ?? 1800);
    if (!Number.isFinite(configured) || configured < 30) {
      return 1800;
    }

    return Math.floor(configured);
  }

  private getWorkflowTimeoutMs(workflow: any): number {
    const workflowTimeoutSeconds = workflow.timeoutSeconds;
    if (
      typeof workflowTimeoutSeconds === 'number' &&
      Number.isFinite(workflowTimeoutSeconds) &&
      workflowTimeoutSeconds >= 30
    ) {
      return workflowTimeoutSeconds * 1000;
    }

    return this.defaultWorkflowTimeoutSeconds * 1000;
  }

  @Interval(AI_WORKFLOW_TIMEOUT_GUARD_INTERVAL_MS)
  async processTimedOutWorkflowRuns(): Promise<void> {
    if (!this.isDispatchEnabled) {
      return;
    }

    const activeRuns = await this.prisma.aiWorkflowRun.findMany({
      where: {
        status: { in: ['DISPATCHED', 'IN_PROGRESS', 'QUEUED'] },
        completedAt: null,
      },
      include: {
        workflow: true,
      },
    });

    if (!activeRuns.length) {
      return;
    }

    const now = Date.now();

    for (const run of activeRuns) {
      const lastDispatchedAt = (run as any).lastDispatchedAt as
        | Date
        | null
        | undefined;
      const referenceTime =
        lastDispatchedAt?.getTime() ?? run.startedAt?.getTime() ?? 0;
      if (!referenceTime) {
        continue;
      }

      const timeoutMs = this.getWorkflowTimeoutMs(run.workflow);
      if (now - referenceTime <= timeoutMs) {
        continue;
      }

      this.logger.warn(
        `Workflow run ${run.id} timed out after ${timeoutMs / 1000}s. Evaluating retry policy.`,
      );

      await this.retryWorkflowRunIfEligible(run.id, 'TIMEOUT', {
        failMessage: 'Workflow run timed out and retries exhausted',
        retryMessage: 'Workflow run timed out, retrying dispatch',
      });
    }
  }

  private async buildDispatchPayload(workflowRunId: string): Promise<{
    workflowId: string;
    workflowGitWorkflowId?: string;
    params: Record<string, any>;
  }> {
    const run = await this.prisma.aiWorkflowRun.findUniqueOrThrow({
      where: { id: workflowRunId },
      include: {
        workflow: { select: { gitWorkflowId: true } },
        submission: { select: { challengeId: true, memberId: true } },
      },
    });

    return {
      workflowId: run.workflowId,
      workflowGitWorkflowId: run.workflow.gitWorkflowId,
      params: {
        workflowId: run.workflowId,
        userId: run.submission?.memberId ?? null,
        challengeId: run.submission?.challengeId,
        submissionId: run.submissionId,
        aiWorkflowId: run.workflowId,
        aiWorkflowRunId: run.id,
      },
    };
  }

  private async retryWorkflowRunIfEligible(
    workflowRunId: string,
    terminalStatus: string,
    logMessages: { failMessage: string; retryMessage: string },
  ): Promise<boolean> {
    const retryInfo = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${stringToHash(`retryWorkflowRun, ${workflowRunId}`)})`;

      const run = await tx.aiWorkflowRun.findUnique({
        where: { id: workflowRunId },
        include: {
          workflow: true,
        },
      });

      if (!run) {
        return { shouldRetry: false, retryCount: 0, hasRun: false };
      }

      const retryCountValue =
        typeof (run as any).retryCount === 'number'
          ? (run as any).retryCount
          : 0;

      if (
        run.completedAt &&
        ['SUCCESS', 'FAILURE', 'CANCELLED', 'TIMEOUT'].includes(run.status)
      ) {
        return {
          shouldRetry: false,
          retryCount: retryCountValue,
          hasRun: true,
        };
      }

      if (retryCountValue >= this.maxWorkflowRetries) {
        await tx.aiWorkflowRun.update({
          where: { id: run.id },
          data: {
            status: terminalStatus,
            completedAt: new Date(),
          },
        });

        return {
          shouldRetry: false,
          retryCount: retryCountValue,
          hasRun: true,
        };
      }

      await tx.aiWorkflowRun.update({
        where: { id: run.id },
        data: {
          retryCount: { increment: 1 },
          status: 'QUEUED',
          completedAt: null,
          startedAt: null,
          lastDispatchedAt: null,
          gitRunId: '',
          gitRunUrl: null,
          jobsCount: 0,
          completedJobs: 0,
          scheduledJobId: null,
        },
      });

      return {
        shouldRetry: true,
        retryCount: retryCountValue + 1,
        hasRun: true,
      };
    });

    if (!retryInfo.hasRun) {
      return false;
    }

    if (!retryInfo.shouldRetry) {
      this.logger.warn(
        `${logMessages.failMessage}. run=${workflowRunId}, retries=${retryInfo.retryCount}/${this.maxWorkflowRetries}`,
      );
      return false;
    }

    this.logger.warn(
      `${logMessages.retryMessage}. run=${workflowRunId}, retry=${retryInfo.retryCount}/${this.maxWorkflowRetries}`,
    );

    const payload = await this.buildDispatchPayload(workflowRunId);
    await this.dispatchWorkflowRun(workflowRunId, payload);
    return true;
  }

  private async triggerEvaluateSubmission(submissionId: string): Promise<void> {
    try {
      const decision =
        await this.aiReviewerDecisionMaker.evaluateSubmission(submissionId);
      const decisionStatus = String((decision as any)?.status ?? '')
        .trim()
        .toUpperCase();
      if (
        decisionStatus &&
        ['PASSED', 'HUMAN_OVERRIDE'].includes(decisionStatus)
      ) {
        await this.submissionService.ensurePendingReviewsForSubmission(
          submissionId,
          {
            requireAiDecisionPass: true,
            triggerSource: 'ai-decision',
          },
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `Failed to evaluate submission ${submissionId}. error=${errorMessage}`,
      );
      try {
        await this.aiReviewerDecisionMaker.markDecisionError(
          submissionId,
          `Failed to evaluate AI decision: ${errorMessage}`,
        );
      } catch (markError) {
        const markErrorMessage =
          markError instanceof Error
            ? markError.message
            : JSON.stringify(markError);
        this.logger.error(
          `Failed to mark AI decision error for submission ${submissionId}: ${markErrorMessage}`,
        );
      }
    }
  }

  async queueWorkflowRuns(
    aiWorkflows: { id: string }[],
    challengeId: string,
    submissionId: string,
  ) {
    const requestedWorkflowIds = aiWorkflows
      .map((workflow) => workflow.id)
      .filter((id): id is string => Boolean(id));

    const activeWorkflows = await this.prisma.aiWorkflow.findMany({
      where: {
        id: { in: requestedWorkflowIds },
        disabled: false,
      },
      select: {
        id: true,
      },
    });

    if (!activeWorkflows.length) {
      this.logger.log(
        `No active AI workflows to queue for challenge ${challengeId}, submission ${submissionId}.`,
      );
      return;
    }

    const workflowRuns = await this.prisma.$transaction(async (tx) => {
      // get a lock for the challengeId, submissionId pair
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${stringToHash(`queueWorkflowRuns, ${challengeId}:${submissionId}`)})`;

      // check if workflow runs have already been queued for this submission
      const alreadyQueued = await this.hasQueuedWorkflowRuns(submissionId);

      if (alreadyQueued) {
        this.logger.log(
          `AI workflow runs already queued for submission ${submissionId}. Skipping queueing.`,
        );
        return [];
      }

      return tx.aiWorkflowRun.createManyAndReturn({
        data: activeWorkflows.map((workflow) => ({
          workflowId: workflow.id,
          submissionId,
          status: 'INIT',
          gitRunId: '',
        })),
        include: {
          workflow: { select: { gitWorkflowId: true } },
        },
      });
    });

    if (!workflowRuns.length) {
      return;
    }

    if (!this.isDispatchEnabled) {
      this.logger.log(
        'AI workflow dispatch is disabled, leaving workflow runs in INIT status.',
      );
      return;
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { memberId: true },
    });
    const userId = submission?.memberId ?? null;

    for (const run of workflowRuns) {
      await this.dispatchWorkflowRun(run.id, {
        workflowId: run.workflowId,
        workflowGitWorkflowId: run.workflow.gitWorkflowId,
        params: {
          workflowId: run.workflowId,
          userId,
          challengeId,
          submissionId,
          aiWorkflowId: run.workflowId,
          aiWorkflowRunId: run.id,
        },
      });
    }
  }

  async hasQueuedWorkflowRuns(submissionId: string): Promise<boolean> {
    if (!submissionId) return false;

    const existing = await this.prisma.aiWorkflowRun.findFirst({
      where: {
        submissionId,
      },
    });

    return !!existing;
  }

  async dispatchWorkflowRun(
    workflowRunId: string,
    payload: {
      workflowId: string;
      workflowGitWorkflowId?: string;
      params: Record<string, any>;
    },
  ) {
    const workflow = await this.prisma.aiWorkflow.findUniqueOrThrow({
      where: { id: payload.workflowId },
    });

    if (workflow.disabled) {
      await this.prisma.aiWorkflowRun.update({
        where: { id: workflowRunId },
        data: {
          status: 'CANCELLED',
          completedAt: new Date(),
        },
      });

      this.logger.warn(
        `Skipping dispatch for disabled workflow ${workflow.id}. run=${workflowRunId}`,
      );
      return;
    }

    const workflowRun = await this.prisma.aiWorkflowRun.findUniqueOrThrow({
      where: { id: workflowRunId },
    });

    const initialState = {
      status: workflowRun.status,
      lastDispatchedAt: workflowRun.lastDispatchedAt,
      completedAt: workflowRun.completedAt,
      startedAt: workflowRun.startedAt,
    };

    await this.prisma.aiWorkflowRun.update({
      where: { id: workflowRun.id },
      data: {
        status: 'DISPATCHED',
        lastDispatchedAt: new Date(),
        completedAt: null,
        startedAt: null,
      },
    });

    let dispatchResult: ActionDispatchWorkflowResponse;

    try {
      dispatchResult = await this.giteaService.runDispatchWorkflow(
        workflow,
        workflowRun,
        payload.params,
      );
    } catch (error) {
      await this.prisma.aiWorkflowRun.update({
        where: { id: workflowRun.id },
        data: {
          ...initialState,
        },
      });

      throw error;
    }

    this.logger.log({
      message: 'Workflow dispatch returned run metadata',
      workflowRunId: workflowRun.id,
      workflowRunGitId: dispatchResult.workflow_run_id,
      workflowRunUrl: dispatchResult.run_url,
      workflowRunHtmlUrl: dispatchResult.html_url,
      raw: JSON.stringify(dispatchResult),
    });

    await this.prisma.aiWorkflowRun.update({
      where: { id: workflowRun.id },
      data: {
        gitRunId: `${dispatchResult.workflow_run_id}`,
        gitRunUrl: dispatchResult.html_url,
        jobsCount: 0,
        completedJobs: 0,
      },
    });

    this.logger.log(`Workflow run ${workflowRunId} dispatched.`);
  }

  async handleWorkflowRunEvents(event: {
    action: 'queued' | 'waiting' | 'in_progress' | 'completed';
    workflow_job: {
      id: number;
      run_id: string;
      html_url: string;
      name: string;
      conclusion: string;
    };
    repository: { full_name: string };
  }) {
    if (!['in_progress', 'completed'].includes(event.action)) {
      this.logger.log(
        `Skipping ${event.action} event for git workflow id ${event.workflow_job.id}.`,
      );
      return;
    }

    const aiWorkflowRuns = await this.prisma.aiWorkflowRun.findMany({
      where: {
        gitRunId: `${event.workflow_job.run_id}`,
      },
      include: {
        workflow: true,
      },
    });

    if (aiWorkflowRuns.length > 1) {
      this.logger.error(
        `ERROR! There are more than 1 workflow runs for gitRunId=${event.workflow_job.run_id} and workflow.gitWorkflowId=${event.workflow_job.name}!`,
      );
      return;
    }

    const [aiWorkflowRun]: ((typeof aiWorkflowRuns)[0] | null)[] =
      aiWorkflowRuns;

    if (
      aiWorkflowRun &&
      !['INIT', 'DISPATCHED', 'IN_PROGRESS'].includes(aiWorkflowRun.status)
    ) {
      const errorMessage = `Unexpected aiWorkflowRun status '${aiWorkflowRun.status}' for gitRunId=${event.workflow_job.run_id} and workflowJobName=${event.workflow_job.name}`;
      this.logger.error(errorMessage);
      return;
    }

    const conclusion = event.workflow_job.conclusion?.toUpperCase();
    const terminalStatus = this.normalizeWorkflowConclusion(conclusion);
    if (
      event.workflow_job.name === 'dump-workflow-context' &&
      terminalStatus !== 'CANCELLED'
    ) {
      this.logger.log(
        `Ignoring dump-workflow-context job event for run ${event.workflow_job.run_id}`,
      );
      return;
    }

    if (!aiWorkflowRun) {
      this.logger.error({
        message: 'No matching aiWorkflowRun found for workflow_job event',
        workflowJobId: event.workflow_job.id,
        gitRunId: event.workflow_job.run_id,
        gitJobStatus: event.action,
      });

      return;
    }

    switch (event.action) {
      case 'in_progress':
        if (aiWorkflowRun.status !== 'DISPATCHED') {
          break;
        }

        await this.prisma.aiWorkflowRun.update({
          where: { id: aiWorkflowRun.id },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
          },
        });
        this.logger.log({
          message: 'Workflow job is now in progress',
          aiWorkflowRunId: aiWorkflowRun.id,
          gitRunId: event.workflow_job.run_id,
          jobId: event.workflow_job.id,
          status: 'IN_PROGRESS',
          timestamp: new Date().toISOString(),
        });
        break;
      case 'completed': {
        const didRetry =
          ['FAILURE', 'TIMEOUT'].includes(terminalStatus) &&
          (await this.retryWorkflowRunIfEligible(
            aiWorkflowRun.id,
            terminalStatus,
            {
              failMessage: `Workflow run ${aiWorkflowRun.id} ${terminalStatus.toLowerCase()} and retries exhausted`,
              retryMessage: `Workflow run ${aiWorkflowRun.id} ${terminalStatus.toLowerCase()}, retrying`,
            },
          ));

        if (didRetry) {
          break;
        }

        await this.prisma.aiWorkflowRun.update({
          where: { id: aiWorkflowRun.id },
          data: {
            status: terminalStatus,
            completedAt: new Date(),
            completedJobs: { increment: 1 },
          },
        });

        await this.triggerEvaluateSubmission(aiWorkflowRun.submissionId);

        this.logger.log({
          message: `Workflow job ${aiWorkflowRun.id} completed with conclusion: ${conclusion}`,
          aiWorkflowRunId: aiWorkflowRun.id,
          gitRunId: event.workflow_job.run_id,
          jobId: event.workflow_job.id,
          status: terminalStatus,
          timestamp: new Date().toISOString(),
        });

        try {
          await this.sendWorkflowRunCompletedNotification(aiWorkflowRun);
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          this.logger.log(
            `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. Got error ${errorMessage}!`,
          );
        }

        // Check if all AI workflows for the challenge are complete and publish phase completion event
        try {
          if (aiWorkflowRun.submissionId) {
            const submission = await this.prisma.submission.findUnique({
              where: { id: aiWorkflowRun.submissionId },
              select: { challengeId: true },
            });

            if (submission?.challengeId) {
              await this.publishAiWorkflowPhaseCompletedEvent(
                submission.challengeId,
                aiWorkflowRun.submissionId,
              );
            }
          }
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          this.logger.error(
            `Failed to publish AI workflow phase completion event for aiWorkflowRun ${aiWorkflowRun.id}. Got error ${errorMessage}!`,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  async sendWorkflowRunCompletedNotification(
    aiWorkflowRun: aiWorkflowRun & { workflow: aiWorkflow },
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: aiWorkflowRun.submissionId },
    });

    if (!submission) {
      this.logger.log(
        `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. Submission ${aiWorkflowRun.submissionId} is missing!`,
      );
      return;
    }

    const [challenge] = await this.challengesPrisma.$queryRaw<
      { id: string; name: string }[]
    >`
      SELECT
        id,
        name
      FROM challenges."Challenge" c
      WHERE c.id=${submission.challengeId}
    `;

    if (!challenge) {
      this.logger.log(
        `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. Challenge ${submission.challengeId} couldn't be fetched!`,
      );
      return;
    }

    const [user] = await this.membersPrisma.$queryRaw<
      {
        handle: string;
        email: string;
        firstName?: string;
        lastName?: string;
      }[]
    >`
      SELECT
        handle,
        email,
        "firstName",
        "lastName"
      FROM members.member u
      WHERE u."userId"::text=${submission.memberId}
    `;

    if (!user) {
      this.logger.log(
        `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. User ${submission.memberId} couldn't be fetched!`,
      );
      return;
    }

    await this.eventBusService.sendEmail({
      ...new EventBusSendEmailPayload(),
      sendgrid_template_id:
        CommonConfig.sendgridConfig.aiWorkflowRunCompletedEmailTemplate,
      recipients: [user.email],
      data: {
        userName:
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.handle,
        aiWorkflowName: aiWorkflowRun.workflow.name,
        reviewLink: `${CommonConfig.ui.reviewUIUrl}/active-challenges/${challenge.id}/reviews/${submission.id}?workflowId=${aiWorkflowRun.workflowId}`,
        submissionId: submission.id,
        challengeName: challenge.name,
      },
    });
  }

  /**
   * Count the number of in-progress AI workflow runs for a challenge.
   * Used to determine if the AI Screening phase can be closed.
   */
  async getInProgressAiWorkflowRunCount(
    challengeId: string,
    aiWorkflowIds: string[],
    submissionId?: string,
  ): Promise<number> {
    if (!aiWorkflowIds || aiWorkflowIds.length === 0) {
      return 0;
    }

    const inProgressStatuses = ['INIT', 'QUEUED', 'DISPATCHED', 'IN_PROGRESS'];

    const count = await this.prisma.aiWorkflowRun.count({
      where: {
        workflowId: { in: aiWorkflowIds },
        status: { in: inProgressStatuses },
        submissionId: submissionId || undefined,
        submission: submissionId
          ? undefined
          : {
              challengeId,
            },
      },
    });

    return count;
  }

  /**
   * Check if all AI workflow runs are complete for a challenge.
   * Returns true if there are no in-progress runs.
   */
  private async areAllAiWorkflowsComplete(
    challengeId: string,
    aiWorkflowIds: string[],
    submissionId?: string,
  ): Promise<boolean> {
    if (!aiWorkflowIds || aiWorkflowIds.length === 0) {
      return true;
    }

    const inProgressCount = await this.getInProgressAiWorkflowRunCount(
      challengeId,
      aiWorkflowIds,
      submissionId,
    );

    return inProgressCount === 0;
  }

  /**
   * Publish an event when AI workflow runs for a submission have completed.
   * For F2F challenges, publishes immediately per-submission.
   * For non-F2F challenges, waits for all AI workflows to complete.
   */
  async publishAiWorkflowPhaseCompletedEvent(
    challengeId: string,
    submissionId: string,
  ): Promise<void> {
    try {
      // Get challenge details to find AI Screening phase
      const challenge =
        await this.challengeApiService.getChallengeDetail(challengeId);

      if (!challenge || !challenge.phases) {
        this.logger.warn(
          `[publishAiWorkflowPhaseCompletedEvent] Challenge ${challengeId} not found or has no phases`,
        );
        return;
      }

      // Find the latest AI Screening phase iteration
      const latestAiScreeningPhase =
        [...challenge.phases]
          .filter((phase) => phase.name === 'AI Screening')
          .sort((a, b) => this.getPhaseSortTime(a) - this.getPhaseSortTime(b))
          .at(-1) ?? null;

      if (!latestAiScreeningPhase) {
        this.logger.debug(
          `[publishAiWorkflowPhaseCompletedEvent] No AI Screening phase found for challenge ${challengeId}`,
        );
        return;
      }

      // Check if AI Screening phase is still open
      if (!latestAiScreeningPhase.isOpen) {
        this.logger.debug(
          `[publishAiWorkflowPhaseCompletedEvent] AI Screening phase ${latestAiScreeningPhase.id} is not open for challenge ${challengeId}`,
        );
        return;
      }

      // Get all AI workflow IDs configured for this challenge
      const aiWorkflowIds: string[] = Array.from(
        new Set(
          (challenge.workflows ?? [])
            .map((workflow) => workflow.id)
            .filter((workflowId): workflowId is string => Boolean(workflowId)),
        ),
      );

      if (aiWorkflowIds.length === 0) {
        this.logger.debug(
          `[publishAiWorkflowPhaseCompletedEvent] No AI workflows configured for challenge ${challengeId}`,
        );
        return;
      }

      // For F2F challenges, publish immediately per-submission without waiting for all workflows.
      // The autopilot will close the AI Screening phase and process submissions one at a time.
      // We still need to ensure all workflows for this submission have completed.
      const isF2F = this.isFirst2FinishChallenge(challenge.type);

      if (isF2F) {
        const submissionComplete = await this.areAllAiWorkflowsComplete(
          challengeId,
          aiWorkflowIds,
          submissionId,
        );

        if (!submissionComplete) {
          this.logger.debug(
            `[publishAiWorkflowPhaseCompletedEvent] Not all AI workflows complete for submission ${submissionId} in challenge ${challengeId}`,
          );
          return;
        }
      } else {
        // For non-F2F challenges, wait for all AI workflows to complete
        const allComplete = await this.areAllAiWorkflowsComplete(
          challengeId,
          aiWorkflowIds,
        );

        if (!allComplete) {
          this.logger.debug(
            `[publishAiWorkflowPhaseCompletedEvent] Not all AI workflows complete for challenge ${challengeId}`,
          );
          return;
        }
      }

      // Get the most recent completed workflow run for this submission to use as representative data
      const recentWorkflowRun = await this.prisma.aiWorkflowRun.findFirst({
        where: {
          submissionId,
          status: { in: ['SUCCESS', 'FAILURE', 'CANCELLED', 'TIMEOUT'] },
        },
        orderBy: {
          completedAt: 'desc',
        },
        select: {
          id: true,
          workflowId: true,
          status: true,
          score: true,
          completedAt: true,
        },
      });

      if (!recentWorkflowRun) {
        this.logger.warn(
          `[publishAiWorkflowPhaseCompletedEvent] No completed workflow run found for submission ${submissionId}`,
        );
        return;
      }

      const payload = {
        challengeId,
        submissionId,
        aiWorkflowRunId: recentWorkflowRun.id,
        aiWorkflowId: recentWorkflowRun.workflowId,
        status: recentWorkflowRun.status,
        score: recentWorkflowRun.score ?? 0,
        completedAt: recentWorkflowRun.completedAt
          ? recentWorkflowRun.completedAt.toISOString()
          : new Date().toISOString(),
      };

      await this.eventBusService.publish(
        'aiworkflow.action.completed',
        payload,
      );
      this.logger.log(
        `[publishAiWorkflowPhaseCompletedEvent] Published AI workflow completion for challenge ${challengeId}, submission ${submissionId}${isF2F ? ' (F2F)' : ', all AI workflows completed'}`,
      );
    } catch (error) {
      this.logger.error(
        `[publishAiWorkflowPhaseCompletedEvent] Failed to publish AI workflow phase completion event for challenge ${challengeId}`,
        error,
      );
      // Don't throw - this is a non-critical notification
    }
  }

  private getPhaseSortTime(phase: PhaseData): number {
    const timestamp = new Date(
      phase.actualStartTime ?? phase.scheduledStartTime ?? '',
    ).getTime();

    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private isFirst2FinishChallenge(typeName?: string): boolean {
    const normalized = (typeName ?? '').trim().toLowerCase();
    return normalized === 'first2finish' || normalized === 'first 2 finish';
  }

  private normalizeWorkflowConclusion(
    conclusion?: string | null,
  ): 'SUCCESS' | 'FAILURE' | 'CANCELLED' | 'TIMEOUT' {
    const normalized = (conclusion ?? '').trim().toUpperCase();

    switch (normalized) {
      case 'SUCCESS':
        return 'SUCCESS';
      case 'FAILURE':
        return 'FAILURE';
      case 'CANCELLED':
        return 'CANCELLED';
      case 'TIMED_OUT':
      case 'TIMEOUT':
        return 'TIMEOUT';
      case 'SKIPPED':
        return 'CANCELLED';
      default:
        this.logger.warn(
          `Unknown workflow conclusion "${conclusion}". Falling back to FAILURE.`,
        );
        return 'FAILURE';
    }
  }
}
