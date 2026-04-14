import { Injectable } from '@nestjs/common';
import { AiReviewDecisionStatus, AiReviewMode, Prisma } from '@prisma/client';
import { LoggerService } from './logger.service';
import { PrismaService } from './prisma.service';

const TERMINAL_RUN_STATUSES = new Set([
  'SUCCESS',
  'FAILURE',
  'CANCELLED',
  'COMPLETED',
]);

type DecisionContextWorkflow = {
  workflowId: string;
  weightPercent: number;
  isGating: boolean;
  minimumPassingScore: number;
  runId: string | null;
  runStatus: string | null;
  runScore: number | null;
};

type DecisionContext = {
  submissionId: string;
  challengeId: string;
  configId: string;
  minPassingThreshold: number;
  autoFinalize: boolean;
  mode: AiReviewMode;
  workflows: DecisionContextWorkflow[];
};

type AiReviewDecisionRecord = {
  id: string;
  submissionId: string;
  configId: string;
  status: AiReviewDecisionStatus;
  totalScore: number | null;
  submissionLocked: boolean;
  reason: string | null;
  breakdown: Prisma.JsonValue | null;
  isFinal: boolean;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DecisionConfigRow = {
  id: string;
  minPassingThreshold: Prisma.Decimal | number | string | null;
  autoFinalize: boolean;
  mode: AiReviewMode;
  workflows: Array<{
    workflowId: string;
    weightPercent: Prisma.Decimal | number | string;
    isGating: boolean;
    workflow: {
      scorecard: {
        minimumPassingScore: number | null;
      };
    };
  }>;
};

type WorkflowRunRow = {
  id: string;
  workflowId: string;
  status: string;
  score: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

const roundTo2 = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

@Injectable()
export class AiReviewerDecisionMakerService {
  private readonly logger: LoggerService;

  constructor(private readonly prisma: PrismaService) {
    this.logger = LoggerService.forRoot(AiReviewerDecisionMakerService.name);
  }

  async evaluateSubmission(
    submissionId: string,
  ): Promise<AiReviewDecisionRecord | null> {
    const context = await this.buildDecisionContext(submissionId);
    if (!context) {
      this.logger.log(
        `Skipping AI decision evaluation: no active config for submission ${submissionId}.`,
      );
      return null;
    }

    const decision = await this.ensurePendingDecision(
      context.submissionId,
      context.configId,
    );

    const isReady = context.workflows.every(
      (workflow) =>
        !!workflow.runId &&
        !!workflow.runStatus &&
        TERMINAL_RUN_STATUSES.has(workflow.runStatus),
    );

    if (!isReady) {
      const pendingDecision = (await this.prisma.aiReviewDecision.update({
        where: {
          submissionId_configId: {
            submissionId: context.submissionId,
            configId: context.configId,
          },
        },
        data: {
          status: AiReviewDecisionStatus.PENDING,
          reason: 'Awaiting completion of all configured AI workflow runs.',
        },
      })) as AiReviewDecisionRecord;
      return pendingDecision;
    }

    const weightedTotal = roundTo2(
      context.workflows.reduce((sum, workflow) => {
        const score = workflow.runScore ?? 0;
        return sum + score * (workflow.weightPercent / 100);
      }, 0),
    );

    const hasBlockingGatingFailure = context.workflows.some(
      (workflow) =>
        workflow.isGating &&
        (workflow.runScore == null ||
          workflow.runScore < workflow.minimumPassingScore),
    );

    const passed =
      !hasBlockingGatingFailure && weightedTotal >= context.minPassingThreshold;

    const status = passed
      ? AiReviewDecisionStatus.PASSED
      : AiReviewDecisionStatus.FAILED;

    const updatedDecision = (await this.prisma.aiReviewDecision.update({
      where: { id: decision.id },
      data: {
        status,
        totalScore: weightedTotal,
        reason: hasBlockingGatingFailure
          ? 'One or more gating AI workflows scored below scorecard minimumPassingScore.'
          : passed
            ? 'Submission passed the configured AI threshold.'
            : 'Submission score is below the configured AI threshold.',
        breakdown: {
          evaluatedAt: new Date().toISOString(),
          mode: context.mode,
          weightedTotal,
          minPassingThreshold: context.minPassingThreshold,
          hasBlockingGatingFailure,
          workflows: context.workflows,
        },
        isFinal: true,
        finalizedAt: new Date(),
        submissionLocked: context.mode === AiReviewMode.AI_GATING && !passed,
      },
    })) as AiReviewDecisionRecord;

    return updatedDecision;
  }

  async markDecisionError(submissionId: string, reason: string): Promise<void> {
    const context = await this.buildDecisionContext(submissionId);
    if (!context) {
      return;
    }

    await this.prisma.aiReviewDecision.update({
      where: {
        submissionId_configId: {
          submissionId,
          configId: context.configId,
        },
      },
      data: {
        status: AiReviewDecisionStatus.ERROR,
        reason,
      },
    });
  }

  private ensurePendingDecision(
    submissionId: string,
    configId: string,
  ): Promise<AiReviewDecisionRecord> {
    return this.prisma.aiReviewDecision.upsert({
      where: {
        submissionId_configId: {
          submissionId,
          configId,
        },
      },
      update: {},
      create: {
        submissionId,
        configId,
        status: AiReviewDecisionStatus.PENDING,
        reason: 'Awaiting completion of all configured AI workflow runs.',
      },
    }) as Promise<AiReviewDecisionRecord>;
  }

  private async buildDecisionContext(
    submissionId: string,
  ): Promise<DecisionContext | null> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, challengeId: true },
    });

    if (!submission?.challengeId) {
      return null;
    }

    const config = (await this.prisma.aiReviewConfig.findFirst({
      where: { challengeId: submission.challengeId },
      select: {
        id: true,
        minPassingThreshold: true,
        autoFinalize: true,
        mode: true,
        workflows: {
          select: {
            workflowId: true,
            weightPercent: true,
            isGating: true,
            workflow: {
              select: {
                scorecard: {
                  select: {
                    minimumPassingScore: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { version: 'desc' },
    })) as DecisionConfigRow | null;

    if (!config) {
      return null;
    }

    const workflowIds = config.workflows.map((workflow) => workflow.workflowId);
    const runs = workflowIds.length
      ? ((await this.prisma.aiWorkflowRun.findMany({
          where: {
            submissionId,
            workflowId: { in: workflowIds },
          },
          select: {
            id: true,
            workflowId: true,
            status: true,
            score: true,
            startedAt: true,
            completedAt: true,
          },
          orderBy: [{ startedAt: 'desc' }, { completedAt: 'desc' }],
        })) as WorkflowRunRow[])
      : [];

    const latestRunByWorkflowId = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      if (!latestRunByWorkflowId.has(run.workflowId)) {
        latestRunByWorkflowId.set(run.workflowId, run);
      }
    }

    return {
      submissionId,
      challengeId: submission.challengeId,
      configId: config.id,
      minPassingThreshold: Number(config.minPassingThreshold),
      autoFinalize: config.autoFinalize,
      mode: config.mode,
      workflows: config.workflows.map((workflow) => {
        const latestRun = latestRunByWorkflowId.get(workflow.workflowId);
        return {
          workflowId: workflow.workflowId,
          weightPercent: Number(workflow.weightPercent),
          isGating: workflow.isGating,
          minimumPassingScore: Number(
            workflow.workflow.scorecard.minimumPassingScore ?? 0,
          ),
          runId: latestRun?.id ?? null,
          runStatus: latestRun?.status ?? null,
          runScore: latestRun?.score ?? null,
        };
      }),
    };
  }
}
