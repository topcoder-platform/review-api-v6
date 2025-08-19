import { Injectable, Logger } from '@nestjs/common';
import { Api, Repository } from 'src/shared/clients/gitea/gitea.client';
import { WorkflowData } from './challenge.service';

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
    owner: string,
    workflow: WorkflowData,
    challengeId: string,
  ): Promise<void> {
    this.logger.log(
      `Running workflow: ${workflow.workflowId} with ref: ${workflow.ref}`,
    );
    try {
      const response = await this.giteaClient.repos.actionsDispatchWorkflow(
        owner,
        challengeId,
        workflow.workflowId,
        {
          ref: workflow.ref,
          inputs: workflow.params,
        },
      );
      // successful execution of workflow dispatch actually just returns "204 No Content". So we only log status.
      this.logger.log(`Workflow dispatched successfully: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Error dispatching workflow ${workflow.workflowId}: ${error.message}`,
      );
      throw error;
    }
  }
}
