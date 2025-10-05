import { Injectable, Logger } from '@nestjs/common';
import { Api, Repository } from 'src/shared/clients/gitea/gitea.client';
import { aiWorkflow, aiWorkflowRun } from '@prisma/client';

/**
 * GiteaService handles interactions with the Gitea API, specifically for managing repositories.
 */
@Injectable()
export class GiteaService {
  private readonly logger: Logger = new Logger(GiteaService.name);
  private readonly giteaClient: Api<any>;

  /**
   * Initializes the Gitea client with the base URL and authorization token.
   */
  constructor() {
    this.giteaClient = new Api({
      baseURL:
        process.env.GITEA_BASE_URL || 'https://git.topcoder-dev.com/api/v1',
      headers: {
        Authorization: `Bearer ${process.env.GITEA_TOKEN}`,
      },
    });

    this.logger.log('GiteaService initialized');
  }

  /**
   * Checks if a repository exists for the given challenge ID under owner and creates it if it does not exist.
   * @param challengeId The ID of the challenge.
   */
  async checkAndCreateRepository(
    owner: string,
    challengeId: string,
  ): Promise<void> {
    this.logger.log(
      `Check and create repository for challengeId: ${challengeId}`,
    );
    let repository: Repository | undefined;
    try {
      const axRespRepo = await this.giteaClient.repos.repoGet(
        owner,
        challengeId,
      );
      repository = axRespRepo.data;
      this.logger.log(
        `Retrieved the following repository: id: ${repository.id}, name: ${repository.name}, url: ${repository.url}`,
      );
      return;
    } catch (error) {
      this.logger.error(
        `Error fetching repository ${challengeId}. status code: ${error.status}, message: ${error.message}`,
      );
      // don't throw error here as we want to create it if it does not exist
    }
    try {
      if (!repository) {
        // we also create if repository does not exist
        this.logger.log(`Trying to create ${challengeId} repository.`);
        const axRespRepo = await this.giteaClient.user.createCurrentUserRepo({
          auto_init: true,
          default_branch:
            process.env.GITEA_SUBMISSION_REVIEW_NEW_REPO_DEF_BRANCH ||
            'develop',
          name: challengeId,
          private: false,
          description: `Repository for challenge ${challengeId}`,
          readme: 'README.md',
        });
        const newrepo = axRespRepo.data;
        this.logger.log(
          `Created the following repository: ${newrepo.id}, name: ${newrepo.name}, url: ${newrepo.url}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error creating repository ${challengeId}. status code: ${error.status}, message: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Runs a workflow for the given challenge ID (repo).
   * @param workflow The workflow data containing the workflow ID, ref, and parameters.
   * @param challengeId The ID of the challenge (same as repo).
   */
  async runDispatchWorkflow(
    workflow: aiWorkflow,
    workflowRun: aiWorkflowRun,
    dispatchInputs: any,
  ): Promise<void> {
    this.logger.log(
      `Running workflow ${workflowRun.workflowId} for submission ${workflowRun.submissionId}`,
    );
    const [owner, repo] = workflow.gitOwnerRepo.split('/');
    this.logger.log(`Calling dispatch`, {
      owner,
      repo,
      workflowId: workflow.gitWorkflowId,
      inputs: dispatchInputs,
    });

    try {
      const response = await this.giteaClient.repos.actionsDispatchWorkflow(
        owner,
        repo,
        workflow.gitWorkflowId,
        {
          ref: 'refs/heads/main',
          inputs: dispatchInputs,
        },
      );
      // successful execution of workflow dispatch actually just returns "204 No Content". So we only log status.
      this.logger.log(
        `Workflow dispatched successfully: ${response.status} ${response.statusText}`,
        JSON.stringify(response.data),
      );
    } catch (error) {
      this.logger.error(
        `Error dispatching workflow ${workflowRun.workflowId}: ${error.message}`,
        error,
      );
      throw error;
    }
  }

  async getAiWorkflowDataFromLogs(
    owner: string,
    repo: string,
    jobId: number,
    retry = 0,
  ): Promise<{ aiWorkflowRunId: string; jobsCount: number } | null> {
    // 120 re-tries means ~60seconds (1/500ms)
    if (retry >= 120) {
      this.logger.error(
        `Error retrieving logs for job ${jobId}. retry limit reached!`,
      );
      return null;
    }

    let logs: string;
    try {
      logs = (
        await this.giteaClient.repos.downloadActionsRunJobLogs(
          owner,
          repo,
          jobId,
        )
      ).data;

      const match = logs.match(/::AI_WORKFLOW_RUN_ID::\s*([a-z0-9-_]{9,})/i);
      if (!match?.[1]) {
        throw new Error('not found aiWorkflowRunId');
      }
      const aiWorkflowRunId = match[1];

      const jobCountMatch = logs.match(/::JOB_COUNT::(\d+)/i);
      const jobsCount = parseInt(jobCountMatch?.[1] ?? '');

      this.logger.log('Fetched aiWorkflowRun data from logs:', {
        jobsCount,
        aiWorkflowRunId,
      });

      return {
        aiWorkflowRunId,
        jobsCount,
      };
    } catch {
      // not handling specific errors because API will throw 500 error before the job is queued
      // and 404 after it started but no logs are available
      // so, seems reasonable to treat it the same
      await new Promise((resolve) => setTimeout(resolve, 500));
      return this.getAiWorkflowDataFromLogs(owner, repo, jobId, retry + 1);
    }
  }
}
