import { Injectable, Logger } from '@nestjs/common';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { ChallengePrismaService } from './challenge-prisma.service';

export class PhaseData {
  id: string;
  name: string;
  isOpen: boolean;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
}

export class ChallengeData {
  id: string;
  name: string;
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
}

export class WorkflowData {
  workflowId: string;
  ref: string;
  params: Record<string, unknown>;
}

interface ChallengeRow {
  id: string;
  name: string;
  status: string;
  typeId: string | null;
  trackId: string | null;
  numOfSubmissions: number | null;
  tags: string[] | null;
  legacyId: number | null;
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

interface ChallengeAggregate {
  challenge: ChallengeRow;
  legacy?: ChallengeLegacyRow;
  type?: ChallengeTypeRow;
  track?: ChallengeTrackRow;
  phases: ChallengePhaseRow[];
  metadata: ChallengeMetadataRow[];
}

@Injectable()
export class ChallengeApiService {
  private readonly logger: Logger = new Logger(ChallengeApiService.name);

  constructor(private readonly challengePrisma: ChallengePrismaService) {}

  async getChallenges(challengeIds: string[]): Promise<ChallengeData[]> {
    // Get all challenge details at once.
    const results = await Promise.all(
      challengeIds.map((id) => this.getChallengeDetail(id)),
    );
    return results;
  }

  async getChallengeDetail(challengeId: string): Promise<ChallengeData> {
    try {
      const [challenge] = await this.challengePrisma.$queryRaw<ChallengeRow[]>`
        SELECT
          id,
          name,
          status::text AS status,
          "typeId",
          "trackId",
          "numOfSubmissions",
          tags,
          "legacyId"
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

      const metadata = await this.challengePrisma.$queryRaw<
        ChallengeMetadataRow[]
      >`
        SELECT name, value
        FROM "ChallengeMetadata"
        WHERE "challengeId" = ${challengeId}
      `;

      return this.mapChallenge({
        challenge,
        legacy,
        type,
        track,
        phases,
        metadata,
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
    const { challenge, legacy, type, track, phases, metadata } = aggregate;

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

    const workflows = this.extractWorkflows(metadata, challenge.id);

    const legacyId = challenge.legacyId ?? legacy?.legacySystemId;

    if (legacyId == null) {
      this.logger.warn(
        `Legacy ID not found for challenge ${challenge.id}. Downstream features may require this identifier.`,
      );
    }

    return {
      id: challenge.id,
      name: challenge.name,
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
    };
  }

  private extractWorkflows(
    metadata: ChallengeMetadataRow[],
    challengeId: string,
  ): WorkflowData[] | undefined {
    if (!Array.isArray(metadata) || !metadata.length) {
      return undefined;
    }

    const workflowEntry = metadata.find(
      (meta) => meta.name?.toLowerCase() === 'workflows',
    );

    if (!workflowEntry?.value) {
      return undefined;
    }

    try {
      const parsed: unknown = JSON.parse(workflowEntry.value);
      const workflowEntries = this.getWorkflowEntries(parsed);

      if (!workflowEntries?.length) {
        return undefined;
      }

      const workflows = this.parseWorkflowEntries(workflowEntries);

      if (!workflows.length) {
        return undefined;
      }

      return workflows;
    } catch (error) {
      this.logger.warn(
        `Unable to parse workflows metadata for challenge ${challengeId}: ${error}`,
      );
      return undefined;
    }
  }

  private getWorkflowEntries(parsed: unknown): unknown[] | undefined {
    if (Array.isArray(parsed)) {
      return parsed as unknown[];
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { workflows?: unknown }).workflows)
    ) {
      return (parsed as { workflows: unknown[] }).workflows;
    }

    return undefined;
  }

  private toWorkflowData(entry: unknown): WorkflowData | undefined {
    if (!entry || typeof entry !== 'object') {
      return undefined;
    }

    const candidate = entry as {
      workflowId?: unknown;
      ref?: unknown;
      params?: unknown;
    };

    if (candidate.workflowId == null || candidate.ref == null) {
      return undefined;
    }

    if (
      typeof candidate.workflowId !== 'string' &&
      typeof candidate.workflowId !== 'number'
    ) {
      return undefined;
    }

    if (
      typeof candidate.ref !== 'string' &&
      typeof candidate.ref !== 'number'
    ) {
      return undefined;
    }

    return {
      workflowId: String(candidate.workflowId),
      ref: String(candidate.ref),
      params: this.coerceWorkflowParams(candidate.params),
    };
  }

  private coerceWorkflowParams(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }

    return input as Record<string, unknown>;
  }

  private parseWorkflowEntries(entries: unknown[]): WorkflowData[] {
    const workflows: WorkflowData[] = [];
    for (const entry of entries) {
      const parsedWorkflow = this.toWorkflowData(entry);
      if (parsedWorkflow) {
        workflows.push(parsedWorkflow);
      }
    }

    return workflows;
  }

  /**
   * Check if a specific phase is currently open for a challenge
   */
  async isPhaseOpen(challengeId: string, phaseName: string): Promise<boolean> {
    try {
      const challenge = await this.getChallengeDetail(challengeId);

      if (!challenge.phases) {
        this.logger.warn(`No phases found for challenge ${challengeId}`);
        return false;
      }

      const phase = challenge.phases.find((p) => p.name === phaseName);
      if (!phase) {
        this.logger.warn(
          `Phase '${phaseName}' not found for challenge ${challengeId}`,
        );
        return false;
      }

      return phase.isOpen;
    } catch (error) {
      this.logger.error(
        `Error checking phase status for challenge ${challengeId}:`,
        error,
      );
      throw error;
    }
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
    const submissionPhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Submission',
    );

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
}
