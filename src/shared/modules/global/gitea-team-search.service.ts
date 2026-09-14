import { Injectable, Logger } from '@nestjs/common';
import { CommonConfig } from 'src/shared/config/common.config';
import { GiteaService, GiteaTeamMatch } from './gitea.service';
import { JwtUser } from './jwt.service';
import { MemberService } from './member.service';

/**
 * Searches Gitea teams on behalf of the signed-in Topcoder user.
 *
 * Teams live in organizations, and a user must not be offered teams they have
 * no access to. The caller is therefore mapped to their Gitea account — by
 * handle first, then by email — and only the organizations that account belongs
 * to are searched. Because the lookup runs with an administrator token, private
 * organizations are included alongside public ones.
 */
@Injectable()
export class GiteaTeamSearchService {
  private readonly logger: Logger = new Logger(GiteaTeamSearchService.name);

  /** Memoized `topcoder userId -> organizations` lookups, with their expiry. */
  private readonly organizationsCache = new Map<
    string,
    { organizations: string[]; expiresAt: number }
  >();

  constructor(
    private readonly giteaService: GiteaService,
    private readonly memberService: MemberService,
  ) {}

  /**
   * Searches the teams the signed-in user can see for a keyword.
   *
   * @param requester Signed-in Topcoder user, from the request's JWT.
   * @param keyword Free text matched against team names.
   * @param limit Maximum number of matches to return.
   * @returns Matches ordered with exact name matches first, empty when the
   * caller has no Gitea account or belongs to no organization.
   * @throws This method does not throw; resolution failures are logged.
   */
  async searchTeams(
    requester: JwtUser | undefined,
    keyword: string,
    limit: number,
  ): Promise<GiteaTeamMatch[]> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) {
      return [];
    }

    const organizations = await this.resolveRequesterOrganizations(requester);
    if (organizations.length === 0) {
      return [];
    }

    return this.giteaService.searchTeams(
      normalizedKeyword,
      limit,
      organizations,
    );
  }

  /**
   * Resolves the organizations the signed-in user belongs to in Gitea.
   *
   * @param requester Signed-in Topcoder user, from the request's JWT.
   * @returns The organization names, empty when they cannot be resolved.
   * @throws This method does not throw; failures are logged.
   */
  private async resolveRequesterOrganizations(
    requester: JwtUser | undefined,
  ): Promise<string[]> {
    const cacheKey = requester?.userId ?? requester?.handle;
    if (!requester || !cacheKey) {
      this.logger.warn(
        'The request carries no Topcoder user, so no Gitea organization can be resolved.',
      );
      return [];
    }

    const cached = this.organizationsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.organizations;
    }

    const giteaUsername = await this.resolveGiteaUsername(requester);
    if (!giteaUsername) {
      return cached?.organizations ?? [];
    }

    let organizations: string[];
    try {
      organizations =
        await this.giteaService.listUserOrganizations(giteaUsername);
    } catch (error) {
      this.logger.error(
        `Unable to list the Gitea organizations of ${giteaUsername}: ${this.describe(error)}`,
      );
      return cached?.organizations ?? [];
    }

    if (organizations.length === 0) {
      this.logger.log(
        `Gitea user ${giteaUsername} belongs to no organization, so no team can be found.`,
      );
    }

    this.organizationsCache.set(cacheKey, {
      organizations,
      expiresAt: Date.now() + CommonConfig.gitea.organizationsCacheTtlMs,
    });
    return organizations;
  }

  /**
   * Maps the signed-in Topcoder user onto their Gitea username.
   *
   * The handle is tried first because Gitea accounts provisioned by this
   * service use it verbatim. Accounts created another way are found by the
   * member's email instead.
   *
   * @param requester Signed-in Topcoder user, from the request's JWT.
   * @returns The Gitea username, or undefined when there is no account.
   * @throws This method does not throw; lookup failures are logged.
   */
  private async resolveGiteaUsername(
    requester: JwtUser,
  ): Promise<string | undefined> {
    const handle = requester.handle?.trim();

    if (handle) {
      try {
        const byHandle = await this.giteaService.getUser(handle);
        if (byHandle?.login) {
          return byHandle.login;
        }
      } catch (error) {
        this.logger.error(
          `Unable to look up Gitea user ${handle}: ${this.describe(error)}`,
        );
        return undefined;
      }
    }

    const email = await this.resolveRequesterEmail(requester);
    if (!email) {
      this.logger.warn(
        `No Gitea account matches Topcoder user ${handle ?? requester.userId}.`,
      );
      return undefined;
    }

    try {
      const byEmail = await this.giteaService.findUserByEmail(email);
      if (byEmail?.login) {
        return byEmail.login;
      }
    } catch (error) {
      this.logger.error(
        `Unable to look up a Gitea user for ${handle ?? requester.userId} by email: ${this.describe(error)}`,
      );
      return undefined;
    }

    this.logger.warn(
      `No Gitea account matches Topcoder user ${handle ?? requester.userId}.`,
    );
    return undefined;
  }

  /**
   * Reads the signed-in user's email from the member database.
   *
   * @param requester Signed-in Topcoder user, from the request's JWT.
   * @returns The member email, or undefined when it cannot be resolved.
   * @throws This method does not throw; lookup failures are logged.
   */
  private async resolveRequesterEmail(
    requester: JwtUser,
  ): Promise<string | undefined> {
    if (!requester.userId) {
      return undefined;
    }

    try {
      const members = await this.memberService.getUserEmails([
        requester.userId,
      ]);
      return members.find((member) => member.email)?.email ?? undefined;
    } catch (error) {
      this.logger.error(
        `Unable to look up the email of member ${requester.userId}: ${this.describe(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Renders an unknown error value as a log-friendly string.
   *
   * @param error Value thrown by a collaborator.
   * @returns A message including the HTTP status when available.
   * @throws This method does not throw.
   */
  private describe(error: unknown): string {
    const candidate = error as
      | { message?: unknown; response?: { status?: number } }
      | undefined;
    const status = candidate?.response?.status;
    const message =
      typeof candidate?.message === 'string'
        ? candidate.message
        : String(error);
    return status === undefined ? message : `status ${status}: ${message}`;
  }
}
