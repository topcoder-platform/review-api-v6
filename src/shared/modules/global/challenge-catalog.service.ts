import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CommonConfig } from 'src/shared/config/common.config';
import { M2MService } from './m2m.service';
import { SubmissionType } from '@prisma/client';
import { ChallengeData } from './challenge.service';

type ChallengeTypeRecord = { id: string; name: string };
type ChallengeTrackRecord = { id: string; name: string };

@Injectable()
export class ChallengeCatalogService implements OnModuleInit {
  private readonly logger = new Logger(ChallengeCatalogService.name);

  private typesById = new Map<string, ChallengeTypeRecord>();
  private typesByName = new Map<string, ChallengeTypeRecord>();
  private tracksById = new Map<string, ChallengeTrackRecord>();
  private tracksByName = new Map<string, ChallengeTrackRecord>();

  constructor(
    private readonly httpService: HttpService,
    private readonly m2mService: M2MService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await Promise.all([this.refreshTypes(), this.refreshTracks()]);
      this.logger.log(
        `Loaded ${this.typesById.size} challenge type(s) and ${this.tracksById.size} track(s) from v6 API`,
      );
    } catch (e) {
      this.logger.warn(
        `Failed to warm challenge catalog from v6 API: ${(e as Error)?.message}`,
      );
    }
  }

  private async fetchFromV6<T = any>(endpoint: string): Promise<T> {
    const base = (CommonConfig.apis.v6ApiUrl || '').replace(/\/$/, '');
    const url = `${base}/${endpoint.replace(/^\//, '')}`;
    const headers: Record<string, string> = {};
    try {
      // Prefer M2M token if available (some envs require auth)
      const token = await this.m2mService.getM2MToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // proceed without auth
    }

    try {
      const resp = await firstValueFrom(
        this.httpService.get<T>(url, { headers }),
      );
      return resp.data;
    } catch (e) {
      if (e instanceof AxiosError) {
        this.logger.error(`Http Error: ${e.message}`, e.response?.data);
        throw new Error(`Cannot load ${endpoint} from v6 API`);
      }
      throw e;
    }
  }

  async refreshTypes(): Promise<void> {
    const list =
      await this.fetchFromV6<ChallengeTypeRecord[]>('challenge-types');
    const byId = new Map<string, ChallengeTypeRecord>();
    const byName = new Map<string, ChallengeTypeRecord>();
    for (const item of list || []) {
      byId.set(item.id, item);
      const nameKey = this.normalizeTypeName(item.name);
      if (nameKey) {
        byName.set(nameKey, item);
      }
    }
    this.typesById = byId;
    this.typesByName = byName;
  }

  async refreshTracks(): Promise<void> {
    const list =
      await this.fetchFromV6<ChallengeTrackRecord[]>('challenge-tracks');
    const byId = new Map<string, ChallengeTrackRecord>();
    const byName = new Map<string, ChallengeTrackRecord>();
    for (const item of list || []) {
      byId.set(item.id, item);
      const nameKey = this.normalizeTrackName(item.name);
      if (nameKey) {
        byName.set(nameKey, item);
      }
    }
    this.tracksById = byId;
    this.tracksByName = byName;
  }

  getTypeNameById(id?: string): string | undefined {
    if (!id) return undefined;
    return this.typesById.get(id)?.name;
  }

  getTrackNameById(id?: string): string | undefined {
    if (!id) return undefined;
    return this.tracksById.get(id)?.name;
  }

  getTypeIdByName(name?: string): string | undefined {
    const normalized = this.normalizeTypeName(name);
    if (!normalized) return undefined;
    return this.typesByName.get(normalized)?.id;
  }

  getTrackIdByName(name?: string): string | undefined {
    const normalized = this.normalizeTrackName(name);
    if (!normalized) return undefined;
    return this.tracksByName.get(normalized)?.id;
  }

  async ensureTypesLoaded(): Promise<void> {
    if (this.typesById.size > 0 && this.typesByName.size > 0) {
      return;
    }
    await this.refreshTypes();
  }

  async ensureTracksLoaded(): Promise<void> {
    if (this.tracksById.size > 0 && this.tracksByName.size > 0) {
      return;
    }
    await this.refreshTracks();
  }

  private normalizeTypeName(name?: string): string | undefined {
    return name?.trim().toLowerCase();
  }

  private normalizeTrackName(name?: string): string | undefined {
    if (!name) return undefined;
    // Normalize to enum-like uppercase with underscores
    return name.trim().toUpperCase().replace(/\s+/g, '_');
  }

  /**
   * Ensures the requested submission type is allowed for the given challenge
   * type and track. Throws on violation.
   */
  ensureSubmissionTypeAllowed(
    submissionType: SubmissionType,
    challenge: ChallengeData,
  ): void {
    // Determine challenge type name
    const typeId: string | undefined = (challenge as any)?.typeId;
    const typeName = this.getTypeNameById(typeId) || (challenge as any)?.type;
    const typeNameNorm = this.normalizeTypeName(typeName);

    // Determine track name
    const trackStr = challenge?.track || challenge?.legacy?.track;
    const trackId: string | undefined = (challenge as any)?.trackId;
    const trackName = trackStr || this.getTrackNameById(trackId);
    const trackNameNorm = this.normalizeTrackName(trackName);

    if (!typeNameNorm || !trackNameNorm) {
      const missing =
        !typeNameNorm && !trackNameNorm
          ? 'challenge type and track'
          : !typeNameNorm
            ? 'challenge type'
            : 'challenge track';
      throw new Error(
        `Cannot validate submission type: missing ${missing} for challenge ${challenge?.id}`,
      );
    }

    // Allowed mappings
    const allowed: Record<
      SubmissionType,
      { types: Set<string>; tracks: Set<string> }
    > = {
      [SubmissionType.CONTEST_SUBMISSION]: {
        types: new Set(['task', 'marathon match', 'challenge', 'first2finish']),
        tracks: new Set([
          'DEVELOPMENT',
          'DATA_SCIENCE',
          'DESIGN',
          'QUALITY_ASSURANCE',
        ]),
      },
      [SubmissionType.SPECIFICATION_SUBMISSION]: {
        types: new Set(['challenge']),
        tracks: new Set(['DESIGN']),
      },
      [SubmissionType.CHECKPOINT_SUBMISSION]: {
        types: new Set(['challenge']),
        tracks: new Set(['DESIGN']),
      },
      [SubmissionType.STUDIO_FINAL_FIX_SUBMISSION]: {
        types: new Set(['challenge']),
        tracks: new Set(['DESIGN']),
      },
    } as const;

    const rule = allowed[submissionType];
    const typeOk = rule.types.has(typeNameNorm);
    const trackOk = rule.tracks.has(trackNameNorm);
    if (!typeOk || !trackOk) {
      throw new Error(
        `Submission type ${submissionType} is not allowed for challenge type '${typeName}' and track '${trackName}'.`,
      );
    }
  }
}
