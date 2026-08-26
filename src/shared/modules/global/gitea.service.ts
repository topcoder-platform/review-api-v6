import {
  BadRequestException,
  HttpExceptionOptions,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { AxiosResponse } from 'axios';
import { Api, Repository, User } from 'src/shared/clients/gitea/gitea.client';
import { aiWorkflow, aiWorkflowRun } from '@prisma/client';
import { CommonConfig } from 'src/shared/config/common.config';

/** How long the Gitea organization list is reused across team searches. */
const ORGANIZATIONS_CACHE_TTL_MS = 5 * 60 * 1000;
/** Page size used when listing Gitea organizations. */
const ORGANIZATIONS_PAGE_SIZE = 50;
/** Safety bound on organization pages, so a paging bug cannot loop forever. */
const ORGANIZATIONS_MAX_PAGES = 20;

export interface GiteaUserProvisionInput {
  /** Topcoder handle, used verbatim as the Gitea username. */
  handle: string;
  /** Topcoder user id, used to build the auth0 sign-in name. */
  userId: string;
  /** Member email address. Required by Gitea when creating an account. */
  email: string;
}

/** A Gitea team matched by a team search, qualified by its organization. */
export interface GiteaTeamMatch {
  /** Numeric Gitea team id, the value Gitea team endpoints address teams by. */
  id: number;
  /** Team name, unique only within its organization. */
  name: string;
  /** Name of the organization owning the team. */
  organization: string;
  /** Team description, when Gitea has one. */
  description?: string;
}

export interface ActionDispatchWorkflowResponse {
  workflow_run_id: number;
  run_url: string;
  html_url: string;
}

/**
 * GiteaService handles interactions with the Gitea API, specifically for managing repositories.
 */
@Injectable()
export class GiteaService {
  private readonly logger: Logger = new Logger(GiteaService.name);
  private readonly giteaClient: Api<any>;
  private organizationsCache?: {
    loadedAt: number;
    organizations: string[];
  };

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
  ): Promise<ActionDispatchWorkflowResponse> {
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
      const response: AxiosResponse =
        await this.giteaClient.repos.actionsDispatchWorkflow(
          owner,
          repo,
          workflow.gitWorkflowId,
          {
            ref: 'refs/heads/main',
            inputs: dispatchInputs,
          },
          {
            query: {
              return_run_details: true,
            },
          } as any,
        );
      this.logger.log(
        `Workflow dispatched successfully: ${response.status} ${response.statusText}`,
        JSON.stringify(response.data),
      );

      return response.data as ActionDispatchWorkflowResponse;
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

  async getWorkflowRunArtifacts(owner: string, repo: string, gitJobId: number) {
    if (!Number.isFinite(gitJobId) || gitJobId <= 0) {
      throw new BadRequestException(
        `Invalid gitJobId: ${gitJobId}. Expected a positive finite job ID.`,
      );
    }

    try {
      const response = await this.giteaClient.repos.getArtifactsOfRun(
        owner,
        repo,
        gitJobId,
      );

      if (response.status > 299) {
        throw new InternalServerErrorException(`${response.statusText}`, {
          description: (response.data as any)?.message,
        } as HttpExceptionOptions);
      }

      return response.data;
    } catch (e) {
      this.logger.error(
        'Failed to fetch Artifacts for git action run',
        e?.message ?? e,
        {
          owner,
          repo,
          gitJobId,
        },
      );
      throw e;
    }
  }

  /**
   * Resolves the HTTP status code carried by an Axios/Gitea client error.
   *
   * @param error Rejection raised by the generated Gitea client.
   * @returns The HTTP status code, or undefined when the failure is not an HTTP response.
   * @throws This function never throws.
   */
  private static resolveErrorStatus(error: unknown): number | undefined {
    const candidate = error as
      | { status?: number; response?: { status?: number } }
      | undefined;
    return candidate?.response?.status ?? candidate?.status;
  }

  /**
   * Looks up a Gitea user by username.
   *
   * @param username Gitea username (the Topcoder handle).
   * @returns The Gitea user, or null when no account exists.
   * @throws Propagates non-404 failures raised by the Gitea API.
   */
  async getUser(username: string): Promise<User | null> {
    try {
      const response = await this.giteaClient.users.userGet(username);
      return response.data;
    } catch (error) {
      if (GiteaService.resolveErrorStatus(error) === 404) {
        return null;
      }
      this.logger.error(
        `Error fetching Gitea user ${username}. status code: ${GiteaService.resolveErrorStatus(error)}, message: ${error?.message}`,
      );
      throw error;
    }
  }

  /**
   * Ensures a Gitea account exists for the given Topcoder member, creating one
   * against the Topcoder authentication source when it is missing.
   *
   * @param member Handle, Topcoder user id and email of the member.
   * @returns The existing or freshly created Gitea user.
   * @throws Propagates Gitea API failures so the caller can decide how to react.
   */
  async ensureUser(member: GiteaUserProvisionInput): Promise<User> {
    const existing = await this.getUser(member.handle);
    if (existing) {
      this.logger.log(
        `Gitea user ${member.handle} already exists (id: ${existing.id}).`,
      );
      return existing;
    }

    this.logger.log(
      `Gitea user ${member.handle} not found. Creating account for Topcoder user ${member.userId}.`,
    );

    try {
      const response = await this.giteaClient.admin.adminCreateUser({
        email: member.email,
        full_name: member.email,
        login_name: `auth0|${member.userId}`,
        must_change_password: false,
        source_id: CommonConfig.gitea.authSourceId,
        username: member.handle,
        visibility: CommonConfig.gitea.userVisibility,
      });
      this.logger.log(
        `Created Gitea user ${member.handle} (id: ${response.data.id}).`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error creating Gitea user ${member.handle}. status code: ${GiteaService.resolveErrorStatus(error)}, message: ${error?.message}`,
      );
      throw error;
    }
  }

  /**
   * Adds a Gitea user to a Gitea team.
   *
   * @param teamId Gitea team id as configured on the challenge.
   * @param username Gitea username to add.
   * @returns Nothing.
   * @throws Propagates Gitea API failures.
   */
  async addTeamMember(teamId: number, username: string): Promise<void> {
    await this.giteaClient.teams.orgAddTeamMember(teamId, username);
  }

  /**
   * Removes a Gitea user from a Gitea team.
   *
   * @param teamId Gitea team id as configured on the challenge.
   * @param username Gitea username to remove.
   * @returns Nothing.
   * @throws Propagates Gitea API failures.
   */
  async removeTeamMember(teamId: number, username: string): Promise<void> {
    await this.giteaClient.teams.orgRemoveTeamMember(teamId, username);
  }

  /**
   * Searches every Gitea organization for teams matching a keyword.
   *
   * Team names are only unique within an organization, so each match is
   * returned with the organization owning it and callers keep the numeric team
   * id. Organizations are cached briefly because the list changes rarely and a
   * typeahead calls this on every keystroke. A single organization failing its
   * search never hides the matches found in the others.
   *
   * @param keyword Free text matched against team names.
   * @param limit Maximum number of matches to return.
   * @returns Matches ordered with exact name matches first, then by name.
   * @throws Propagates only a failure to list the organizations.
   */
  async searchTeams(keyword: string, limit: number): Promise<GiteaTeamMatch[]> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) {
      return [];
    }

    const organizations = await this.listOrganizations();
    const matchesPerOrg = await Promise.all(
      organizations.map((organization) =>
        this.searchOrganizationTeams(organization, normalizedKeyword, limit),
      ),
    );

    const matches = new Map<number, GiteaTeamMatch>();
    for (const match of matchesPerOrg.flat()) {
      if (!matches.has(match.id)) {
        matches.set(match.id, match);
      }
    }

    const lowerKeyword = normalizedKeyword.toLowerCase();
    return Array.from(matches.values())
      .sort((left, right) => {
        const leftExact = left.name.toLowerCase() === lowerKeyword ? 0 : 1;
        const rightExact = right.name.toLowerCase() === lowerKeyword ? 0 : 1;
        return (
          leftExact - rightExact ||
          left.name.localeCompare(right.name) ||
          left.organization.localeCompare(right.organization)
        );
      })
      .slice(0, limit);
  }

  /**
   * Searches a single organization for teams matching a keyword.
   *
   * @param organization Gitea organization name.
   * @param keyword Free text matched against team names.
   * @param limit Maximum number of matches to request from Gitea.
   * @returns The organization's matches, empty when the search fails.
   * @throws This method does not throw; failures are logged.
   */
  private async searchOrganizationTeams(
    organization: string,
    keyword: string,
    limit: number,
  ): Promise<GiteaTeamMatch[]> {
    try {
      const response = await this.giteaClient.orgs.teamSearch(organization, {
        q: keyword,
        include_desc: false,
        limit,
      });

      return (response.data?.data ?? []).flatMap((team) =>
        typeof team.id === 'number' && team.name
          ? [
              {
                id: team.id,
                name: team.name,
                organization,
                description: team.description || undefined,
              },
            ]
          : [],
      );
    } catch (error) {
      this.logger.error(
        `Error searching Gitea teams in organization ${organization}. status code: ${GiteaService.resolveErrorStatus(error)}, message: ${error?.message}`,
      );
      return [];
    }
  }

  /**
   * Lists every Gitea organization, memoized for a short period.
   *
   * @returns The organization names known to Gitea.
   * @throws Propagates Gitea API failures when the cache is cold.
   */
  private async listOrganizations(): Promise<string[]> {
    const now = Date.now();
    if (
      this.organizationsCache &&
      now - this.organizationsCache.loadedAt < ORGANIZATIONS_CACHE_TTL_MS
    ) {
      return this.organizationsCache.organizations;
    }

    const organizations: string[] = [];
    for (let page = 1; page <= ORGANIZATIONS_MAX_PAGES; page += 1) {
      const response = await this.giteaClient.admin.adminGetAllOrgs({
        page,
        limit: ORGANIZATIONS_PAGE_SIZE,
      });
      const pageOrganizations = (response.data ?? []).flatMap(
        (organization) => {
          const name = organization.name || organization.username;
          return name ? [name] : [];
        },
      );
      organizations.push(...pageOrganizations);

      if ((response.data?.length ?? 0) < ORGANIZATIONS_PAGE_SIZE) {
        this.organizationsCache = { loadedAt: now, organizations };
        return organizations;
      }
    }

    this.logger.warn(
      `Stopped listing Gitea organizations after ${ORGANIZATIONS_MAX_PAGES} pages; team search may miss organizations.`,
    );
    this.organizationsCache = { loadedAt: now, organizations };
    return organizations;
  }

  async downloadWorkflowRunArtifact(
    owner: string,
    repo: string,
    artifactId: string,
  ) {
    try {
      return await this.giteaClient.repos.downloadArtifact(
        owner,
        repo,
        artifactId,
        {
          format: 'stream',
        },
      );
    } catch (e) {
      this.logger.error(
        'Failed to download Artifact for git action run',
        e?.message ?? e,
        {
          owner,
          repo,
          artifactId,
        },
      );
      throw e;
    }
  }
}
