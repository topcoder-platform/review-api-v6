import { HttpService } from '@nestjs/axios';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { ChallengePrismaService } from './challenge-prisma.service';
import { isAdmin, JwtUser } from './jwt.service';
import { M2MService } from './m2m.service';

const GROUP_MEMBERSHIP_CACHE_MS = 60_000;
const MAX_GROUP_MEMBERSHIP_CACHE_ENTRIES = 1_000;

export class PhaseData {
  id: string;
  name: string;
  isOpen: boolean;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
}

/**
 * Winner data loaded from challenge storage for consumers that need challenge
 * result information.
 */
export class ChallengeWinnerData {
  userId: number;
  handle: string;
  placement: number;
  type?: string | undefined;
}

export class ChallengeData {
  id: string;
  name: string;
  description?: string | undefined;
  // v6 identifiers
  typeId?: string | undefined;
  trackId?: string | undefined;
  // Some payloads may embed a type name directly (not guaranteed)
  type?: string | undefined;
  legacy?: {
    track?: string | undefined;
    subTrack?: string | undefined;
  };
  status: ChallengeStatus;
  numOfSubmissions?: number | undefined;
  track: string;
  legacyId: number;
  tags?: string[] | undefined;
  workflows?: WorkflowData[] | undefined;
  phases?: PhaseData[] | undefined;
  metadata?: Record<string, string | null> | undefined;
  winners?: ChallengeWinnerData[] | undefined;
  createdAt?: Date | undefined;
  createdBy?: string | undefined;
  updatedAt?: Date | undefined;
  updatedBy?: string | undefined;
}

export class WorkflowData {
  id: string;
  name: string;
  description: string;
  llmId: string;
  defUrl: string;
  gitOwnerRepo: string;
  scorecardId: string;
}

interface ChallengeRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  typeId: string | null;
  trackId: string | null;
  numOfSubmissions: number | null;
  tags: string[] | null;
  legacyId: number | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

interface ChallengeSummaryRow extends ChallengeRow {
  legacyTrack: string | null;
  legacySubTrack: string | null;
  legacySystemId: number | null;
  typeName: string | null;
  trackName: string | null;
  trackAbbreviation: string | null;
  trackEnum: string | null;
}

interface ChallengeLegacyRow {
  track: string | null;
  subTrack: string | null;
  legacySystemId: number | null;
}

interface ChallengeTypeRow {
  name: string | null;
}

interface ChallengeTrackRow {
  name: string | null;
  abbreviation: string | null;
  track: string | null;
}

interface ChallengePhaseRow {
  id: string;
  name: string;
  isOpen: boolean | null;
  scheduledStartDate: Date | null;
  scheduledEndDate: Date | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
}

interface ChallengeMetadataRow {
  name: string | null;
  value: string | null;
}

interface ChallengeWinnerRow {
  userId: number;
  handle: string;
  placement: number;
  type: string | null;
}

interface ChallengeUserWhitelistRow {
  challengeId: string;
  userId: string;
}

interface ChallengeGroupRow {
  id: string;
  groups: string[] | null;
  taskIsTask: boolean;
  hasMemberAccess: boolean;
}

interface GroupMembershipCacheEntry {
  groupIds: Set<string>;
  expiresAt: number;
}

interface ChallengeAggregate {
  challenge: ChallengeRow;
  legacy?: ChallengeLegacyRow;
  type?: ChallengeTypeRow;
  track?: ChallengeTrackRow;
  phases: ChallengePhaseRow[];
  metadata: ChallengeMetadataRow[];
  workflows: WorkflowData[];
  winners: ChallengeWinnerRow[];
}

@Injectable()
export class ChallengeApiService {
  private readonly logger: Logger = new Logger(ChallengeApiService.name);
  private readonly groupMembershipCache = new Map<
    string,
    GroupMembershipCacheEntry
  >();

  /**
   * Creates the challenge visibility reader.
   *
   * @param challengePrisma challenge database connection
   * @param httpService HTTP client used to resolve a member's complete group tree
   * @param m2mService service token provider for the groups API
   */
  constructor(
    private readonly challengePrisma: ChallengePrismaService,
    private readonly httpService?: HttpService,
    private readonly m2mService?: M2MService,
  ) {}

  /**
   * Determine whether challenge whitelist checks apply for a request.
   * Interactive users, including admins and anonymous callers, must be
   * evaluated; M2M callers bypass this user-facing access control.
   *
   * @param authUser the authenticated request user, if any
   * @returns true when whitelist rules should be applied
   */
  shouldApplyChallengeWhitelist(authUser?: JwtUser | null): boolean {
    return !authUser?.isMachine;
  }

  /**
   * Filter challenge ids by both the challenge user whitelist and challenge
   * group membership. The historical method name is retained for API
   * consumers, but this is the canonical review-api challenge visibility
   * boundary. Anonymous callers see only ungrouped challenges; ordinary users
   * see ungrouped challenges plus their complete group tree. Admin and M2M
   * callers bypass group filtering, while interactive whitelist checks still
   * apply to admins. Evaluation failures fail closed for restricted records.
   *
   * @param authUser the authenticated request user, if any
   * @param challengeIds challenge ids to filter
   * @returns challenge ids visible to the caller
   */
  async filterChallengeIdsByWhitelist(
    authUser: JwtUser | null | undefined,
    challengeIds: string[],
  ): Promise<string[]> {
    const ids = Array.from(
      new Set(
        (challengeIds ?? [])
          .map((id) => String(id ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );

    if (!ids.length || !this.shouldApplyChallengeWhitelist(authUser)) {
      return ids;
    }

    const userId =
      authUser?.userId !== undefined && authUser.userId !== null
        ? String(authUser.userId).trim()
        : '';

    try {
      const rows = await this.challengePrisma.$queryRaw<
        ChallengeUserWhitelistRow[]
      >(Prisma.sql`
        SELECT "challengeId", "userId"
        FROM "ChallengeUserWhitelist"
        WHERE "challengeId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
      `);

      const restrictedIds = new Set(rows.map((row) => row.challengeId));
      const allowedRestrictedIds = new Set(
        rows
          .filter((row) => userId && String(row.userId) === userId)
          .map((row) => row.challengeId),
      );

      const whitelistVisibleIds = ids.filter(
        (id) => !restrictedIds.has(id) || allowedRestrictedIds.has(id),
      );
      return this.filterChallengeIdsByGroups(authUser, whitelistVisibleIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Challenge whitelist evaluation failed: ${message}`);
      return [];
    }
  }

  /**
   * Applies challenge group visibility to already whitelist-visible ids.
   *
   * @param authUser authenticated caller, if any
   * @param challengeIds ids that passed user-whitelist filtering
   * @returns ids whose group restriction is visible to the caller
   */
  private async filterChallengeIdsByGroups(
    authUser: JwtUser | null | undefined,
    challengeIds: string[],
  ): Promise<string[]> {
    if (
      !challengeIds.length ||
      authUser?.isMachine ||
      (authUser && isAdmin(authUser))
    ) {
      return challengeIds;
    }

    let rows: ChallengeGroupRow[];
    try {
      rows = await this.challengePrisma.$queryRaw<ChallengeGroupRow[]>(
        Prisma.sql`
          SELECT
            c.id,
            c.groups,
            c."taskIsTask",
            EXISTS (
              SELECT 1
              FROM "MemberChallengeAccess" access
              WHERE access."challengeId" = c.id
                AND access."memberId" = ${String(authUser?.userId ?? '')}
            ) AS "hasMemberAccess"
          FROM "Challenge" c
          WHERE c.id IN (${Prisma.join(
            challengeIds.map((id) => Prisma.sql`${id}`),
          )})
        `,
      );
    } catch (error) {
      this.logger.warn(
        `Challenge group visibility query failed: ${this.errorMessage(error)}`,
      );
      return [];
    }

    const groupsByChallenge = new Map(
      rows.map((row) => [
        row.id,
        Array.isArray(row.groups)
          ? row.groups.map((group) => String(group).trim()).filter(Boolean)
          : [],
      ]),
    );
    const memberAccessByChallenge = new Map(
      rows.map((row) => [row.id, row.hasMemberAccess === true]),
    );
    const taskVisibleByChallenge = new Map(
      rows.map((row) => [
        row.id,
        row.taskIsTask !== true || row.hasMemberAccess === true,
      ]),
    );
    const publicIds = challengeIds.filter(
      (id) =>
        groupsByChallenge.has(id) &&
        (groupsByChallenge.get(id) ?? []).length === 0 &&
        taskVisibleByChallenge.get(id) === true,
    );
    if (!authUser?.userId) {
      return publicIds;
    }

    const memberGroups = await this.getMemberGroupIds(String(authUser.userId));
    if (!memberGroups) {
      return publicIds;
    }
    return challengeIds.filter((id) => {
      if (!groupsByChallenge.has(id)) return false;
      const challengeGroups = groupsByChallenge.get(id) ?? [];
      return (
        taskVisibleByChallenge.get(id) === true &&
        (memberAccessByChallenge.get(id) === true ||
          challengeGroups.length === 0 ||
          challengeGroups.some((groupId) => memberGroups.has(groupId)))
      );
    });
  }

  /**
   * Loads and briefly caches every group id in a member's ancestor tree.
   * Failures return null so callers can retain public challenges while hiding
   * all group-restricted records.
   *
   * @param userId Topcoder member identifier
   * @returns accessible group ids, or null when membership cannot be verified
   */
  private async getMemberGroupIds(userId: string): Promise<Set<string> | null> {
    const now = Date.now();
    const cached = this.groupMembershipCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.groupIds;
    }
    if (!this.httpService || !this.m2mService) {
      this.logger.warn('Groups API dependencies are unavailable.');
      return null;
    }

    try {
      const token = await this.m2mService.getM2MToken();
      const baseUrl = CommonConfig.apis.groupsApiUrl.replace(/\/$/, '');
      const response = await firstValueFrom(
        this.httpService.get(
          `${baseUrl}/memberGroups/${encodeURIComponent(userId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params: { uuid: true },
          },
        ),
      );
      const groupIds = this.normalizeGroupIds(response.data);
      this.pruneGroupMembershipCache(now);
      this.groupMembershipCache.set(userId, {
        groupIds,
        expiresAt: now + GROUP_MEMBERSHIP_CACHE_MS,
      });
      return groupIds;
    } catch (error) {
      this.logger.warn(
        `Groups API membership lookup failed: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Extracts group identifiers from the compatibility shapes returned by
   * groups-api-v6, including ancestor and nested response containers.
   *
   * @param payload unknown groups API response body
   * @returns normalized group identifiers
   */
  private normalizeGroupIds(payload: unknown): Set<string> {
    const ids = new Set<string>();
    const visit = (value: unknown, depth: number): void => {
      if (value == null || depth > 8) return;
      if (typeof value === 'string' || typeof value === 'number') {
        const normalized = String(value).trim();
        if (normalized && normalized !== 'null' && normalized !== 'undefined') {
          ids.add(normalized);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => visit(entry, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      ['id', 'groupId', 'oldId', 'legacyId', 'uuid'].forEach((key) => {
        if (record[key] != null) visit(record[key], depth + 1);
      });
      [
        'data',
        'result',
        'content',
        'path',
        'pathIds',
        'pathGroupIds',
        'parentGroups',
        'ancestors',
        'ancestorGroupIds',
        'subGroups',
        'children',
        'groupIds',
        'membershipGroupIds',
      ].forEach((key) => {
        if (record[key] != null) visit(record[key], depth + 1);
      });
    };
    visit(payload, 0);
    return ids;
  }

  /**
   * Removes expired group membership entries and bounds cache memory.
   *
   * @param now current epoch time in milliseconds
   * @returns nothing
   */
  private pruneGroupMembershipCache(now: number): void {
    for (const [key, entry] of this.groupMembershipCache) {
      if (entry.expiresAt <= now) this.groupMembershipCache.delete(key);
    }
    if (this.groupMembershipCache.size >= MAX_GROUP_MEMBERSHIP_CACHE_ENTRIES) {
      const oldestKey = this.groupMembershipCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey) this.groupMembershipCache.delete(oldestKey);
    }
  }

  /**
   * Converts an unknown visibility error to operator-safe text.
   *
   * @param error unknown thrown value
   * @returns diagnostic message
   */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Ensure an interactive caller is allowed by the challenge whitelist.
   * Removing a participant from the whitelist cuts off review-api access
   * immediately; active review assignments may still require manual
   * reassignment or cleanup outside this first-pass access gate.
   *
   * @param authUser the authenticated request user, if any
   * @param challengeId challenge id to evaluate
   * @throws ForbiddenException when the whitelist blocks the caller or evaluation fails
   */
  async ensureChallengeWhitelistAccess(
    authUser: JwtUser | null | undefined,
    challengeId: string,
  ): Promise<void> {
    const visibleIds = await this.filterChallengeIdsByWhitelist(authUser, [
      challengeId,
    ]);
    if (!visibleIds.includes(challengeId)) {
      throw new ForbiddenException({
        message: "You don't have access to view this challenge",
        code: 'FORBIDDEN_CHALLENGE_WHITELIST',
        details: { challengeId },
      });
    }
  }

  /**
   * Get challenge details after enforcing challenge whitelist access for the caller.
   *
   * @param authUser the authenticated request user, if any
   * @param challengeId challenge id to load
   * @returns challenge details visible to the caller
   */
  async getChallengeDetailForUser(
    authUser: JwtUser | null | undefined,
    challengeId: string,
  ): Promise<ChallengeData> {
    await this.ensureChallengeWhitelistAccess(authUser, challengeId);
    return this.getChallengeDetail(challengeId);
  }

  /**
   * Get challenge details for ids visible to the caller.
   *
   * @param authUser the authenticated request user, if any
   * @param challengeIds challenge ids to load
   * @returns challenge details visible to the caller
   */
  async getChallengesForUser(
    authUser: JwtUser | null | undefined,
    challengeIds: string[],
  ): Promise<ChallengeData[]> {
    const visibleIds = await this.filterChallengeIdsByWhitelist(
      authUser,
      challengeIds,
    );
    return this.getChallenges(visibleIds);
  }

  async getChallenges(challengeIds: string[]): Promise<ChallengeData[]> {
    // Get all challenge details at once.
    const results = await Promise.all(
      challengeIds.map((id) => this.getChallengeDetail(id)),
    );
    return results;
  }

  /**
   * Hydrates the lightweight challenge projection needed by opportunity list
   * cards in one database query. Detail-only phases, workflows, metadata, and
   * winners are intentionally deferred until a user opens a specific item.
   *
   * @param challengeIds challenge identifiers represented on the current page
   * @returns challenge card data in the caller-provided identifier order
   * @throws Error when the challenge database query fails
   */
  async getChallengeSummaries(
    challengeIds: string[],
  ): Promise<ChallengeData[]> {
    const ids = Array.from(
      new Set(
        challengeIds
          .map((id) => String(id ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );
    if (!ids.length) {
      return [];
    }

    try {
      const rows = await this.challengePrisma.$queryRaw<ChallengeSummaryRow[]>(
        Prisma.sql`
          SELECT
            c.id,
            c.name,
            c.description,
            c.status::text AS status,
            c."typeId",
            c."trackId",
            c."numOfSubmissions",
            c.tags,
            c."legacyId",
            c."createdAt",
            c."createdBy",
            c."updatedAt",
            c."updatedBy",
            legacy.track AS "legacyTrack",
            legacy."subTrack" AS "legacySubTrack",
            legacy."legacySystemId" AS "legacySystemId",
            challenge_type.name AS "typeName",
            challenge_track.name AS "trackName",
            challenge_track.abbreviation AS "trackAbbreviation",
            challenge_track.track::text AS "trackEnum"
          FROM "Challenge" c
          LEFT JOIN "ChallengeLegacy" legacy
            ON legacy."challengeId" = c.id
          LEFT JOIN "ChallengeType" challenge_type
            ON challenge_type.id = c."typeId"
          LEFT JOIN "ChallengeTrack" challenge_track
            ON challenge_track.id = c."trackId"
          WHERE c.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
        `,
      );
      const byId = new Map<string, ChallengeData>(
        rows.map((row) => [
          row.id,
          {
            id: row.id,
            name: row.name,
            description: row.description ?? undefined,
            typeId: row.typeId ?? undefined,
            trackId: row.trackId ?? undefined,
            type: row.typeName ?? undefined,
            legacy:
              row.legacyTrack || row.legacySubTrack
                ? {
                    track: row.legacyTrack ?? undefined,
                    subTrack: row.legacySubTrack ?? undefined,
                  }
                : undefined,
            status: (row.status as ChallengeStatus) ?? ChallengeStatus.NEW,
            numOfSubmissions: row.numOfSubmissions ?? 0,
            track:
              row.trackName ??
              row.trackAbbreviation ??
              row.legacyTrack ??
              row.trackEnum ??
              '',
            legacyId: row.legacyId ?? row.legacySystemId ?? 0,
            tags: row.tags ?? undefined,
          } as ChallengeData,
        ]),
      );
      return ids
        .map((id) => byId.get(id))
        .filter((challenge): challenge is ChallengeData => challenge != null);
    } catch (error) {
      this.logger.error(
        `Error retrieving ${ids.length} challenge summaries from database:`,
        error,
      );
      throw new Error('Cannot get data from Challenge DB.');
    }
  }

  async getChallengeDetail(challengeId: string): Promise<ChallengeData> {
    try {
      const [challenge] = await this.challengePrisma.$queryRaw<ChallengeRow[]>`
        SELECT
          id,
          name,
          description,
          status::text AS status,
          "typeId",
          "trackId",
          "numOfSubmissions",
          tags,
          "legacyId",
          "createdAt",
          "createdBy",
          "updatedAt",
          "updatedBy"
        FROM "Challenge"
        WHERE id = ${challengeId}
        LIMIT 1
      `;

      if (!challenge) {
        throw new Error(`Challenge ${challengeId} not found.`);
      }

      const [legacy] = await this.challengePrisma.$queryRaw<
        ChallengeLegacyRow[]
      >`
        SELECT "track", "subTrack", "legacySystemId"
        FROM "ChallengeLegacy"
        WHERE "challengeId" = ${challengeId}
        LIMIT 1
      `;

      const type = challenge.typeId
        ? (
            await this.challengePrisma.$queryRaw<ChallengeTypeRow[]>`
                SELECT name
                FROM "ChallengeType"
                WHERE id = ${challenge.typeId}
                LIMIT 1
              `
          )[0]
        : undefined;

      const track = challenge.trackId
        ? (
            await this.challengePrisma.$queryRaw<ChallengeTrackRow[]>`
                SELECT name, abbreviation, track
                FROM "ChallengeTrack"
                WHERE id = ${challenge.trackId}
                LIMIT 1
              `
          )[0]
        : undefined;

      const phases = await this.challengePrisma.$queryRaw<ChallengePhaseRow[]>`
        SELECT
          id,
          name,
          "isOpen",
          "scheduledStartDate",
          "scheduledEndDate",
          "actualStartDate",
          "actualEndDate"
        FROM "ChallengePhase"
        WHERE "challengeId" = ${challengeId}
      `;

      const workflows = await this.challengePrisma.$queryRaw<WorkflowData[]>`
        SELECT
          id,
          name,
          description,
          "llmId",
          "defUrl",
          "gitOwnerRepo",
          "scorecardId"
        FROM reviews."aiWorkflow"
        WHERE id IN (
          SELECT "aiWorkflowId" FROM "ChallengeReviewer"
          WHERE "isMemberReview"=false AND "challengeId" = ${challengeId}
        )
        AND "disabled" = false
      `;

      const metadata = await this.challengePrisma.$queryRaw<
        ChallengeMetadataRow[]
      >`
        SELECT name, value
        FROM "ChallengeMetadata"
        WHERE "challengeId" = ${challengeId}
      `;

      const winners = await this.challengePrisma.$queryRaw<
        ChallengeWinnerRow[]
      >`
        SELECT
          "userId",
          handle,
          placement,
          type::text AS type
        FROM "ChallengeWinner"
        WHERE "challengeId" = ${challengeId}
        ORDER BY placement ASC
      `;

      return this.mapChallenge({
        challenge,
        legacy,
        type,
        track,
        phases,
        metadata,
        workflows,
        winners,
      });
    } catch (error) {
      this.logger.error(
        `Error retrieving challenge ${challengeId} from database:`,
        error,
      );
      throw new Error('Cannot get data from Challenge DB.');
    }
  }

  private mapChallenge(aggregate: ChallengeAggregate): ChallengeData {
    const {
      challenge,
      legacy,
      type,
      track,
      phases,
      workflows,
      metadata,
      winners,
    } = aggregate;

    const mappedPhases = phases?.map((phase) => ({
      id: phase.id,
      name: phase.name,
      isOpen: phase.isOpen ?? false,
      scheduledStartTime: phase.scheduledStartDate?.toISOString(),
      scheduledEndTime: phase.scheduledEndDate?.toISOString(),
      actualStartTime: phase.actualStartDate?.toISOString(),
      actualEndTime: phase.actualEndDate?.toISOString(),
    }));

    const legacyRecord = legacy
      ? {
          track: legacy.track ?? undefined,
          subTrack: legacy.subTrack ?? undefined,
        }
      : undefined;

    // const workflows = this.extractWorkflows(metadata, challenge.id);

    const legacyId = challenge.legacyId ?? legacy?.legacySystemId;

    if (legacyId == null) {
      this.logger.warn(
        `Legacy ID not found for challenge ${challenge.id}. Downstream features may require this identifier.`,
      );
    }

    const metadataRecord: Record<string, string | null> | undefined =
      metadata && metadata.length
        ? metadata.reduce<Record<string, string | null>>((acc, entry) => {
            if (entry?.name) {
              acc[entry.name] = entry.value ?? null;
            }
            return acc;
          }, {})
        : undefined;

    return {
      id: challenge.id,
      name: challenge.name,
      description: challenge.description ?? undefined,
      typeId: challenge.typeId ?? undefined,
      trackId: challenge.trackId ?? undefined,
      type: type?.name ?? undefined,
      legacy: legacyRecord,
      status: (challenge.status as ChallengeStatus) ?? ChallengeStatus.NEW,
      numOfSubmissions: challenge.numOfSubmissions ?? 0,
      track:
        track?.name ??
        track?.abbreviation ??
        legacyRecord?.track ??
        track?.track ??
        '',
      legacyId: legacyId ?? 0,
      tags: challenge.tags ?? undefined,
      workflows,
      phases: mappedPhases,
      metadata: metadataRecord,
      winners: winners?.map((winner) => ({
        userId: winner.userId,
        handle: winner.handle,
        placement: winner.placement,
        type: winner.type ?? undefined,
      })),
      createdAt: challenge.createdAt,
      createdBy: challenge.createdBy ?? undefined,
      updatedAt: challenge.updatedAt,
      updatedBy: challenge.updatedBy ?? undefined,
    };
  }

  /**
   * Check if one of the specified phases is currently open for a challenge
   */
  async isPhaseOpen(
    challengeId: string,
    phaseNames: string | string[],
  ): Promise<boolean> {
    try {
      const challenge = await this.getChallengeDetail(challengeId);

      if (!challenge.phases) {
        this.logger.warn(`No phases found for challenge ${challengeId}`);
        return false;
      }

      const names = Array.isArray(phaseNames) ? phaseNames : [phaseNames];
      const matchingPhases = challenge.phases.filter((p) =>
        names.includes(p.name),
      );

      if (!matchingPhases.length) {
        const namesForLog = names.map((name) => `'${name}'`).join(' or ');
        this.logger.warn(
          `Phase${names.length > 1 ? 's' : ''} ${namesForLog} not found for challenge ${challengeId}`,
        );
        return false;
      }

      for (const phase of matchingPhases) {
        if (phase.isOpen) {
          return true;
        }
      }

      for (const phase of matchingPhases) {
        const computedOpen = this.isPhaseWindowOpen(phase);
        if (computedOpen) {
          this.logger.debug(
            `Derived '${phase.name}' phase open state from schedule for challenge ${challengeId}`,
          );
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Error checking phase status for challenge ${challengeId}:`,
        error,
      );
      throw error;
    }
  }

  private isPhaseWindowOpen(
    phase: PhaseData,
    referenceDate = new Date(),
  ): boolean {
    // Prefer actual timestamps when available. If the phase has an
    // actual start but no actual end yet, treat it as open regardless
    // of the scheduled end (phases can start late and outlive the
    // scheduled window until an actual end is recorded).
    const hasActualStart = !!phase.actualStartTime;
    const start = this.parsePhaseDate(
      phase.actualStartTime ?? phase.scheduledStartTime,
    );
    if (!start) {
      return false;
    }

    if (referenceDate < start) {
      return false;
    }

    // If we have an actual end, respect it. Otherwise, only fall back to
    // the scheduled end when there is no actual start (purely schedule-based).
    const actualEnd = this.parsePhaseDate(phase.actualEndTime);
    if (actualEnd) {
      if (referenceDate > actualEnd) {
        return false;
      }
    } else if (!hasActualStart) {
      const scheduledEnd = this.parsePhaseDate(phase.scheduledEndTime);
      if (scheduledEnd && referenceDate > scheduledEnd) {
        return false;
      }
    }

    return true;
  }

  private parsePhaseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.debug(`Could not parse phase date '${value}'`);
      return undefined;
    }

    return parsed;
  }

  /**
   * Validate if reviews can be submitted (Review or Iterative Review phase is open)
   */
  async validateReviewSubmission(challengeId: string): Promise<void> {
    const reviewPhaseOpen = await this.isPhaseOpen(challengeId, 'Review');
    const iterativeReviewPhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Iterative Review',
    );

    if (!reviewPhaseOpen && !iterativeReviewPhaseOpen) {
      throw new Error(
        `Reviews cannot be submitted for challenge ${challengeId}. Neither Review nor Iterative Review phase is currently open.`,
      );
    }
  }

  /**
   * Validate if appeals can be submitted (Appeals phase is open)
   */
  async validateAppealSubmission(challengeId: string): Promise<void> {
    const appealsPhaseOpen = await this.isPhaseOpen(challengeId, 'Appeals');

    if (!appealsPhaseOpen) {
      throw new Error(
        `Appeals cannot be submitted for challenge ${challengeId}. Appeals phase is not currently open.`,
      );
    }
  }

  /**
   * Validate if appeal responses can be submitted (Appeals Response phase is open)
   */
  async validateAppealResponseSubmission(challengeId: string): Promise<void> {
    const appealsResponsePhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Appeals Response',
    );

    if (!appealsResponsePhaseOpen) {
      throw new Error(
        `Appeal responses cannot be submitted for challenge ${challengeId}. Appeals Response phase is not currently open.`,
      );
    }
  }

  /**
   * Validate if submissions can be created (Submission phase is open)
   */
  async validateSubmissionCreation(challengeId: string): Promise<void> {
    const submissionPhaseOpen = await this.isPhaseOpen(challengeId, [
      'Submission',
      'Topgear Submission',
    ]);

    if (!submissionPhaseOpen) {
      throw new Error(
        `Submissions cannot be created for challenge ${challengeId}. Submission phase is not currently open.`,
      );
    }
  }

  /**
   * Validate if a challenge exists and is active
   */
  async validateChallengeExists(challengeId: string): Promise<ChallengeData> {
    try {
      const challenge = await this.getChallengeDetail(challengeId);

      // Basic validation that challenge exists
      if (!challenge || !challenge.id) {
        throw new Error(`Challenge ${challengeId} not found or is invalid.`);
      }

      return challenge;
    } catch (error) {
      this.logger.error(`Error validating challenge ${challengeId}:`, error);
      throw new Error(`Challenge ${challengeId} not found or is invalid.`);
    }
  }

  /**
   * Validate if checkpoint submissions can be created (Checkpoint Submission phase is open)
   */
  async validateCheckpointSubmissionCreation(
    challengeId: string,
  ): Promise<void> {
    const checkpointSubmissionPhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Checkpoint Submission',
    );

    if (!checkpointSubmissionPhaseOpen) {
      throw new Error(
        `Checkpoint submissions cannot be created for challenge ${challengeId}. Checkpoint Submission phase is not currently open.`,
      );
    }
  }

  /**
   * Validate if final-fix submissions can be created (Final Fix phase is open)
   */
  async validateFinalFixSubmissionCreation(challengeId: string): Promise<void> {
    const finalFixPhaseOpen = await this.isPhaseOpen(challengeId, 'Final Fix');

    if (!finalFixPhaseOpen) {
      throw new Error(
        `Final fix submissions cannot be created for challenge ${challengeId}. Final Fix phase is not currently open.`,
      );
    }
  }
}
