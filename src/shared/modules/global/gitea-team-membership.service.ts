import { Injectable, Logger } from '@nestjs/common';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeApiService } from './challenge.service';
import { GiteaService } from './gitea.service';
import { MemberService } from './member.service';

/**
 * Shape of the `gitea` challenge metadata value maintained by Work Manager.
 */
interface GiteaChallengeMetadata {
  teams?: unknown;
}

/**
 * A Gitea team configured on a challenge.
 */
export interface GiteaTeamRef {
  /** Numeric Gitea team id, the value Gitea team endpoints address teams by. */
  id: number;
  /** Team name, kept for logging only. */
  name?: string;
}

/**
 * Outcome of a single team membership attempt, aggregated for logging.
 */
export interface GiteaTeamSyncResult {
  teamId: number;
  teamName?: string;
  succeeded: boolean;
  error?: string;
}

/**
 * Participant identity required to reconcile Gitea team membership.
 */
export interface GiteaMembershipMember {
  memberId: string;
  memberHandle: string;
}

/**
 * Keeps Gitea team membership in sync with challenge registrations.
 *
 * Work Manager stores the Gitea teams picked in the challenge editor under the
 * challenge metadata key `gitea`
 * (`{"teams":[{"id":42,"name":"my-team","org":"topcoder"}]}`). Registrations add
 * the member to each team and unregistrations remove them. Every Gitea call is
 * isolated so a misconfigured or stale team never blocks the remaining teams,
 * and each attempt is logged with its result.
 */
@Injectable()
export class GiteaTeamMembershipService {
  private readonly logger: Logger = new Logger(GiteaTeamMembershipService.name);

  constructor(
    private readonly giteaService: GiteaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly memberService: MemberService,
  ) {}

  /**
   * Adds a challenge registrant to every Gitea team configured on the challenge.
   *
   * Provisions the Gitea account first when the handle is not yet known to
   * Gitea. Failures are logged and swallowed so the Kafka message is not
   * retried indefinitely for configuration problems.
   *
   * @param challengeId Challenge the member registered for.
   * @param member Registrant handle and Topcoder user id.
   * @returns The per-team results, empty when the challenge has no Gitea config.
   * @throws This method does not throw; all failures are logged.
   */
  async addMemberToChallengeTeams(
    challengeId: string,
    member: GiteaMembershipMember,
  ): Promise<GiteaTeamSyncResult[]> {
    const teams = await this.resolveTeams(challengeId);
    if (teams.length === 0) {
      return [];
    }

    const provisioned = await this.ensureGiteaAccount(member);
    if (!provisioned) {
      return [];
    }

    const results = await this.runForEachTeam(teams, (team) =>
      this.giteaService.addTeamMember(team.id, member.memberHandle),
    );
    this.logSummary('add', challengeId, member, results);
    return results;
  }

  /**
   * Removes a challenge registrant from every Gitea team configured on the
   * challenge.
   *
   * @param challengeId Challenge the member unregistered from.
   * @param member Registrant handle and Topcoder user id.
   * @returns The per-team results, empty when the challenge has no Gitea config.
   * @throws This method does not throw; all failures are logged.
   */
  async removeMemberFromChallengeTeams(
    challengeId: string,
    member: GiteaMembershipMember,
  ): Promise<GiteaTeamSyncResult[]> {
    const teams = await this.resolveTeams(challengeId);
    if (teams.length === 0) {
      return [];
    }

    const results = await this.runForEachTeam(teams, (team) =>
      this.giteaService.removeTeamMember(team.id, member.memberHandle),
    );
    this.logSummary('remove', challengeId, member, results);
    return results;
  }

  /**
   * Reads the challenge metadata and extracts the configured Gitea teams.
   *
   * @param challengeId Challenge whose metadata is inspected.
   * @returns Unique, well-formed teams. Empty when unset or unparseable.
   * @throws This method does not throw; lookup failures are logged.
   */
  private async resolveTeams(challengeId: string): Promise<GiteaTeamRef[]> {
    let rawValue: string | null | undefined;
    try {
      const challenge =
        await this.challengeApiService.getChallengeDetail(challengeId);
      rawValue = challenge?.metadata?.[CommonConfig.gitea.challengeMetadataKey];
    } catch (error) {
      this.logger.error(
        `Unable to load challenge ${challengeId} while syncing Gitea teams: ${this.describe(error)}`,
      );
      return [];
    }

    if (!rawValue) {
      this.logger.log(
        `Challenge ${challengeId} has no "${CommonConfig.gitea.challengeMetadataKey}" metadata. Skipping Gitea team sync.`,
      );
      return [];
    }

    const parsed = this.parseGiteaMetadata(challengeId, rawValue);
    if (!parsed) {
      return [];
    }

    if (!Array.isArray(parsed.teams)) {
      this.logger.warn(
        `Challenge ${challengeId} Gitea metadata does not contain a "teams" array. Skipping Gitea team sync.`,
      );
      return [];
    }

    const teams: GiteaTeamRef[] = [];
    for (const entry of parsed.teams) {
      const team = this.toTeam(entry);
      if (team === undefined) {
        this.logger.warn(
          `Ignoring invalid Gitea team ${JSON.stringify(entry)} configured on challenge ${challengeId}.`,
        );
        continue;
      }
      if (!teams.some((existing) => existing.id === team.id)) {
        teams.push(team);
      }
    }

    this.logger.log(
      `Challenge ${challengeId} is configured with Gitea teams: [${teams
        .map((team) => this.describeTeam(team))
        .join(', ')}].`,
    );
    return teams;
  }

  /**
   * Parses the raw `gitea` metadata value into an object.
   *
   * @param challengeId Challenge the value belongs to, used for logging.
   * @param rawValue Metadata value persisted by Work Manager.
   * @returns The parsed object, or undefined when the value is not usable.
   * @throws This method does not throw.
   */
  private parseGiteaMetadata(
    challengeId: string,
    rawValue: unknown,
  ): GiteaChallengeMetadata | undefined {
    if (typeof rawValue === 'object' && rawValue !== null) {
      return rawValue as GiteaChallengeMetadata;
    }

    if (typeof rawValue !== 'string') {
      this.logger.warn(
        `Challenge ${challengeId} Gitea metadata has unexpected type "${typeof rawValue}". Skipping Gitea team sync.`,
      );
      return undefined;
    }

    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('value is not a JSON object');
      }
      return parsed as GiteaChallengeMetadata;
    } catch (error) {
      this.logger.warn(
        `Challenge ${challengeId} Gitea metadata is not valid JSON: ${this.describe(error)}. Skipping Gitea team sync.`,
      );
      return undefined;
    }
  }

  /**
   * Normalizes a configured team entry.
   *
   * The editor stores `{ id, name }` objects, but challenges configured before
   * that change may hold a bare id, so both shapes are accepted. Gitea team
   * endpoints address teams by numeric id, so entries without one are rejected.
   *
   * @param value Raw team entry from challenge metadata.
   * @returns The team, or undefined when the entry carries no usable id.
   * @throws This method does not throw.
   */
  private toTeam(value: unknown): GiteaTeamRef | undefined {
    const candidate =
      typeof value === 'object' && value !== null
        ? (value as { id?: unknown; name?: unknown })
        : { id: value };

    const id = this.toTeamId(candidate.id);
    if (id === undefined) {
      return undefined;
    }

    const name =
      typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim()
        : undefined;

    return name === undefined ? { id } : { id, name };
  }

  /**
   * Coerces a raw metadata value into a numeric Gitea team id.
   *
   * @param value Raw id from challenge metadata, a number or a numeric string.
   * @returns The positive integer id, or undefined when the value is invalid.
   * @throws This method does not throw.
   */
  private toTeamId(value: unknown): number | undefined {
    const id =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value.trim())
          : NaN;

    return Number.isInteger(id) && id > 0 ? id : undefined;
  }

  /**
   * Renders a team for logs, including its name when one was configured.
   *
   * @param team Team to describe.
   * @returns Either `id` or `id (name)`.
   * @throws This method does not throw.
   */
  private describeTeam(team: GiteaTeamRef): string {
    return team.name === undefined ? `${team.id}` : `${team.id} (${team.name})`;
  }

  /**
   * Ensures the registrant has a Gitea account before team membership changes.
   *
   * @param member Registrant handle and Topcoder user id.
   * @returns True when an account exists or was created, false otherwise.
   * @throws This method does not throw; failures are logged.
   */
  private async ensureGiteaAccount(
    member: GiteaMembershipMember,
  ): Promise<boolean> {
    try {
      const existing = await this.giteaService.getUser(member.memberHandle);
      if (existing) {
        return true;
      }

      const email = await this.resolveMemberEmail(member);
      if (!email) {
        this.logger.error(
          `Cannot create Gitea user for handle ${member.memberHandle}: no email found for member ${member.memberId}.`,
        );
        return false;
      }

      await this.giteaService.ensureUser({
        email,
        handle: member.memberHandle,
        userId: member.memberId,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to provision Gitea user for handle ${member.memberHandle} (member ${member.memberId}): ${this.describe(error)}`,
      );
      return false;
    }
  }

  /**
   * Looks up the member email required to create a Gitea account.
   *
   * @param member Registrant handle and Topcoder user id.
   * @returns The member email, or undefined when it cannot be resolved.
   * @throws This method does not throw; lookup failures are logged.
   */
  private async resolveMemberEmail(
    member: GiteaMembershipMember,
  ): Promise<string | undefined> {
    try {
      const members = await this.memberService.getUserEmails([member.memberId]);
      return members.find((entry) => entry.email)?.email ?? undefined;
    } catch (error) {
      this.logger.error(
        `Unable to look up email for member ${member.memberId}: ${this.describe(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Applies an operation to each team, isolating and logging per-team failures.
   *
   * @param teams Teams to operate on.
   * @param operation Gitea call to run for a single team.
   * @returns One result per team, in configuration order.
   * @throws This method does not throw.
   */
  private async runForEachTeam(
    teams: GiteaTeamRef[],
    operation: (team: GiteaTeamRef) => Promise<void>,
  ): Promise<GiteaTeamSyncResult[]> {
    const results: GiteaTeamSyncResult[] = [];
    for (const team of teams) {
      try {
        await operation(team);
        results.push({ succeeded: true, teamId: team.id, teamName: team.name });
      } catch (error) {
        results.push({
          error: this.describe(error),
          succeeded: false,
          teamId: team.id,
          teamName: team.name,
        });
      }
    }
    return results;
  }

  /**
   * Emits a per-team log line plus an aggregate summary for one sync run.
   *
   * @param action Either `add` or `remove`.
   * @param challengeId Challenge being synced.
   * @param member Registrant handle and Topcoder user id.
   * @param results Per-team outcomes produced by runForEachTeam.
   * @returns Nothing.
   * @throws This method does not throw.
   */
  private logSummary(
    action: 'add' | 'remove',
    challengeId: string,
    member: GiteaMembershipMember,
    results: GiteaTeamSyncResult[],
  ): void {
    for (const result of results) {
      const team = this.describeTeam({
        id: result.teamId,
        name: result.teamName,
      });
      if (result.succeeded) {
        this.logger.log(
          `Gitea team sync (${action}) succeeded: challenge ${challengeId}, team ${team}, handle ${member.memberHandle}.`,
        );
      } else {
        this.logger.error(
          `Gitea team sync (${action}) failed: challenge ${challengeId}, team ${team}, handle ${member.memberHandle}: ${result.error}`,
        );
      }
    }

    const succeeded = results.filter((result) => result.succeeded).length;
    this.logger.log(
      `Gitea team sync (${action}) completed for challenge ${challengeId}, handle ${member.memberHandle}: ${succeeded}/${results.length} teams updated.`,
    );
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
      | { message?: unknown; response?: { status?: number; data?: unknown } }
      | undefined;
    const status = candidate?.response?.status;
    const message =
      typeof candidate?.message === 'string'
        ? candidate.message
        : String(error);
    const detail = candidate?.response?.data
      ? ` details: ${JSON.stringify(candidate.response.data)}`
      : '';
    return status === undefined
      ? `${message}${detail}`
      : `status ${status}: ${message}${detail}`;
  }
}
