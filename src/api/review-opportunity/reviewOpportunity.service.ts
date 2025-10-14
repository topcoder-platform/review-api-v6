import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  convertRoleName,
  ReviewApplicationRole,
  ReviewApplicationRoleIds,
} from 'src/dto/reviewApplication.dto';
import {
  CreateReviewOpportunityDto,
  QueryReviewOpportunityDto,
  ReviewOpportunityResponseDto,
  ReviewOpportunityStatus,
  ReviewOpportunitySummaryDto,
  UpdateReviewOpportunityDto,
} from 'src/dto/reviewOpportunity.dto';
import { QueryReviewOpportunitySummaryDto } from 'src/dto/reviewOpportunity.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { ChallengeCatalogService } from 'src/shared/modules/global/challenge-catalog.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { Prisma, ReviewApplicationStatus } from '@prisma/client';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

type SubmissionPhaseSummary = {
  scheduledEndDate: Date | null;
  actualEndDate: Date | null;
};

type ChallengeSummaryRow = {
  id: string;
  name: string;
  status: string;
  numOfSubmissions: number | null;
  submissionEndDate: Date | null;
};

type SubmissionPhaseRow = {
  challengeId: string;
  scheduledEndDate: Date | null;
  actualEndDate: Date | null;
};

type ReviewerTotalRow = {
  challengeId: string;
  total: number | bigint | null;
};

@Injectable()
export class ReviewOpportunityService {
  private readonly logger: Logger = new Logger(ReviewOpportunityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeService: ChallengeApiService,
    private readonly challengeCatalog: ChallengeCatalogService,
    private readonly challengePrisma: ChallengePrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {}

  /**
   * Search Review Opportunities
   * @param dto query dto
   */
  async search(dto: QueryReviewOpportunityDto) {
    try {
      // filter data with payment, duration and start date
      const prismaFilter = {
        include: { applications: true },
        where: {
          AND: [
            {
              status: ReviewOpportunityStatus.OPEN,
            },
          ] as any[],
        },
      };
      if (dto.paymentFrom) {
        prismaFilter.where.AND.push({ basePayment: { gte: dto.paymentFrom } });
      }
      if (dto.paymentTo) {
        prismaFilter.where.AND.push({ basePayment: { lte: dto.paymentTo } });
      }
      if (dto.durationFrom) {
        prismaFilter.where.AND.push({ duration: { gte: dto.durationFrom } });
      }
      if (dto.durationTo) {
        prismaFilter.where.AND.push({ duration: { lte: dto.durationTo } });
      }
      if (dto.startDateFrom) {
        prismaFilter.where.AND.push({ startDate: { gte: dto.startDateFrom } });
      }
      if (dto.startDateTo) {
        prismaFilter.where.AND.push({ startDate: { lte: dto.startDateTo } });
      }
      // query data from db
      const entityList =
        await this.prisma.reviewOpportunity.findMany(prismaFilter);
      const challengeMap = await this.buildChallengeMap(entityList);
      const trackFilterIds = await this.resolveTrackFilters(dto.tracks);
      const typeFilterIds = await this.resolveTypeFilters(dto.types);

      // build result with challenge data
      let responseList = this.buildResponseList(entityList, challengeMap);
      // only include opportunities whose challenges are ACTIVE
      responseList = responseList.filter((r) => {
        const challenge = challengeMap.get(r.challengeId);
        return !!challenge && challenge.status === ChallengeStatus.ACTIVE;
      });
      // filter with challenge fields
      if (dto.numSubmissionsFrom) {
        responseList = responseList.filter(
          (r) => (r.submissions ?? 0) >= (dto.numSubmissionsFrom ?? 0),
        );
      }
      if (dto.numSubmissionsTo) {
        responseList = responseList.filter(
          (r) => (r.submissions ?? 0) <= (dto.numSubmissionsTo ?? 0),
        );
      }
      if (trackFilterIds.size > 0) {
        responseList = responseList.filter((r) => {
          const challenge = challengeMap.get(r.challengeId);
          if (!challenge) return false;
          const trackId =
            challenge.trackId ||
            this.challengeCatalog.getTrackIdByName(
              challenge.track || challenge.legacy?.track,
            );
          return !!trackId && trackFilterIds.has(trackId);
        });
      }
      if (typeFilterIds.size > 0) {
        responseList = responseList.filter((r) => {
          const challenge = challengeMap.get(r.challengeId);
          if (!challenge) return false;
          const typeId =
            challenge.typeId ||
            this.challengeCatalog.getTypeIdByName((challenge as any)?.type);
          return !!typeId && typeFilterIds.has(typeId);
        });
      }
      // sort list
      responseList = [...responseList].sort((a, b) => {
        return dto.sortOrder === 'asc'
          ? a[dto.sortBy] - b[dto.sortBy]
          : b[dto.sortBy] - a[dto.sortBy];
      });
      // pagination
      const start = Math.max(0, dto.offset as number);
      const end = Math.min(responseList.length, start + (dto.limit as number));
      responseList = responseList.slice(start, end);
      // return result
      return responseList;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `searching review opportunities with filters - payment: ${dto.paymentFrom}-${dto.paymentTo}, duration: ${dto.durationFrom}-${dto.durationTo}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private async resolveTrackFilters(tracks?: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!tracks || tracks.length === 0) {
      return ids;
    }

    let catalogLoaded = false;
    for (const entry of tracks) {
      const value = (entry ?? '').trim();
      if (!value) {
        continue;
      }

      if (this.looksLikeGuid(value)) {
        ids.add(value);
        continue;
      }

      if (!catalogLoaded) {
        await this.challengeCatalog.ensureTracksLoaded();
        catalogLoaded = true;
      }

      const byName = this.challengeCatalog.getTrackIdByName(value);
      if (byName) {
        ids.add(byName);
        continue;
      }

      throw new BadRequestException(
        `Challenge track '${entry}' is not recognized.`,
      );
    }

    return ids;
  }

  private async resolveTypeFilters(types?: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!types || types.length === 0) {
      return ids;
    }

    let catalogLoaded = false;
    for (const entry of types) {
      const value = (entry ?? '').trim();
      if (!value) {
        continue;
      }

      if (this.looksLikeGuid(value)) {
        ids.add(value);
        continue;
      }

      if (!catalogLoaded) {
        await this.challengeCatalog.ensureTypesLoaded();
        catalogLoaded = true;
      }

      const byName = this.challengeCatalog.getTypeIdByName(value);
      if (byName) {
        ids.add(byName);
        continue;
      }

      throw new BadRequestException(
        `Challenge type '${entry}' is not recognized.`,
      );
    }

    return ids;
  }

  private looksLikeGuid(input: string): boolean {
    const value = input.trim();
    if (!value) {
      return false;
    }

    const hyphenated =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const compact = /^[0-9a-fA-F]{32}$/;
    return hyphenated.test(value) || compact.test(value);
  }

  /**
   * Create review opportunity.
   * @param authUser auth user
   * @param dto dto
   * @returns response
   */
  async create(
    authUser: JwtUser,
    dto: CreateReviewOpportunityDto,
  ): Promise<ReviewOpportunityResponseDto> {
    try {
      // make sure challenge exists first
      let challengeData: ChallengeData;
      try {
        challengeData = await this.challengeService.getChallengeDetail(
          dto.challengeId,
        );
      } catch (e) {
        // challenge doesn't exist. Return 400
        this.logger.error("Can't get challenge:", e);
        throw new BadRequestException(
          `Challenge with ID ${dto.challengeId} doesn't exist`,
        );
      }
      // check existing
      const existing = await this.prisma.reviewOpportunity.findMany({
        where: {
          challengeId: dto.challengeId,
          type: dto.type,
        },
      });
      if (existing && existing.length > 0) {
        throw new ConflictException(
          `Review opportunity already exists for challenge ${dto.challengeId} and type ${dto.type}`,
        );
      }

      const entity = await this.prisma.reviewOpportunity.create({
        data: {
          ...dto,
        },
      });
      return this.buildResponse(entity, challengeData);
    } catch (error) {
      // Re-throw business logic exceptions as-is
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating review opportunity for challenge ${dto.challengeId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Get opportunity by id
   * @param id opportunity id
   * @returns response dto
   */
  async get(id: string) {
    try {
      const entity = await this.checkExists(id);
      return await this.assembleResult(entity);
    } catch (error) {
      // Re-throw NotFoundException from checkExists as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review opportunity ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Update review opportunity by id
   * @param id opportunity id
   * @param dto update dto
   */
  async update(id: string, dto: UpdateReviewOpportunityDto) {
    try {
      await this.checkExists(id);
      const entity = await this.prisma.reviewOpportunity.update({
        where: { id },
        data: {
          ...dto,
        },
      });
      return await this.assembleResult(entity);
    } catch (error) {
      // Re-throw NotFoundException from checkExists as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating review opportunity ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Get review opportunities by challenge id
   * @param challengeId challenge id
   * @returns review opportunity list
   */
  async getByChallengeId(
    challengeId: string,
  ): Promise<ReviewOpportunityResponseDto[]> {
    try {
      const entityList = await this.prisma.reviewOpportunity.findMany({
        where: { challengeId },
        include: { applications: true },
      });
      return await this.assembleList(entityList);
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review opportunities for challenge ${challengeId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async getSummary(dto: QueryReviewOpportunitySummaryDto): Promise<{
    items: ReviewOpportunitySummaryDto[];
    metadata: {
      total: number;
      totalPages: number;
      page: number;
      perPage: number;
    };
  }> {
    try {
      const opportunities = await this.prisma.reviewOpportunity.findMany({
        include: {
          applications: {
            select: {
              status: true,
            },
          },
        },
      });

      if (!opportunities.length) {
        return {
          items: [],
          metadata: {
            page: dto.page,
            perPage: dto.perPage,
            total: 0,
            totalPages: 0,
          },
        };
      }

      const challengeIds = [
        ...new Set(opportunities.map((o) => o.challengeId).filter(Boolean)),
      ];

      if (challengeIds.length === 0) {
        return {
          items: [],
          metadata: {
            page: dto.page,
            perPage: dto.perPage,
            total: 0,
            totalPages: 0,
          },
        };
      }

      const challengeRows = await this.challengePrisma.$queryRaw<
        ChallengeSummaryRow[]
      >(
        Prisma.sql`
          SELECT
            c.id,
            c.name,
            c.status::text AS status,
            c."numOfSubmissions" AS "numOfSubmissions",
            c."submissionEndDate" AS "submissionEndDate"
          FROM "Challenge" c
          WHERE c.id IN (${Prisma.join(
            challengeIds.map((id) => Prisma.sql`${id}`),
          )})
            AND c.status::text = ${ChallengeStatus.ACTIVE}
        `,
      );

      if (!challengeRows.length) {
        return {
          items: [],
          metadata: {
            page: dto.page,
            perPage: dto.perPage,
            total: 0,
            totalPages: 0,
          },
        };
      }

      const challengeMap = new Map<string, ChallengeSummaryRow>();
      for (const challenge of challengeRows) {
        challengeMap.set(challenge.id, challenge);
      }

      const phaseRows = await this.challengePrisma.$queryRaw<
        SubmissionPhaseRow[]
      >(
        Prisma.sql`
          SELECT
            cp."challengeId" AS "challengeId",
            cp."scheduledEndDate" AS "scheduledEndDate",
            cp."actualEndDate" AS "actualEndDate"
          FROM "ChallengePhase" cp
          WHERE cp."challengeId" IN (${Prisma.join(
            challengeIds.map((id) => Prisma.sql`${id}`),
          )})
            AND cp.name = ${'Submission'}
        `,
      );

      const phaseMap = new Map<string, SubmissionPhaseSummary[]>();
      for (const phase of phaseRows) {
        const bucket = phaseMap.get(phase.challengeId) ?? [];
        bucket.push({
          scheduledEndDate: phase.scheduledEndDate ?? null,
          actualEndDate: phase.actualEndDate ?? null,
        });
        phaseMap.set(phase.challengeId, bucket);
      }

      const reviewerRows = await this.challengePrisma.$queryRaw<
        ReviewerTotalRow[]
      >(
        Prisma.sql`
          SELECT
            cr."challengeId" AS "challengeId",
            COALESCE(SUM(cr."memberReviewerCount"), 0) AS "total"
          FROM "ChallengeReviewer" cr
          WHERE cr."challengeId" IN (${Prisma.join(
            challengeIds.map((id) => Prisma.sql`${id}`),
          )})
          GROUP BY cr."challengeId"
        `,
      );

      const reviewerMap = new Map<string, number>();
      for (const reviewer of reviewerRows) {
        const totalValue =
          typeof reviewer.total === 'bigint'
            ? Number(reviewer.total)
            : (reviewer.total ?? 0);
        reviewerMap.set(reviewer.challengeId, totalValue);
      }

      const summaries: ReviewOpportunitySummaryDto[] = [];

      for (const opportunity of opportunities) {
        const challenge = challengeMap.get(opportunity.challengeId);
        if (!challenge) {
          continue;
        }

        const submissionPhase = this.findLatestSubmissionPhase(
          phaseMap.get(challenge.id),
        );
        const submissionEndDate =
          submissionPhase?.actualEndDate ??
          submissionPhase?.scheduledEndDate ??
          challenge.submissionEndDate ??
          null;

        const numberOfPendingApplications = opportunity.applications.reduce(
          (total, application) =>
            application.status === ReviewApplicationStatus.PENDING
              ? total + 1
              : total,
          0,
        );

        const numberOfApprovedApplications = opportunity.applications.reduce(
          (total, application) =>
            application.status === ReviewApplicationStatus.APPROVED
              ? total + 1
              : total,
          0,
        );

        const numberOfReviewerSpots = reviewerMap.get(challenge.id) ?? 0;

        summaries.push({
          challengeId: challenge.id,
          challengeName: challenge.name,
          challengeStatus: challenge.status as ChallengeStatus,
          submissionEndDate,
          numberOfSubmissions: challenge.numOfSubmissions ?? 0,
          numberOfReviewerSpots,
          numberOfPendingApplications,
          numberOfApprovedApplications,
        });
      }

      // sort
      const sortBy = (dto?.sortBy ||
        'submissionEndDate') as keyof ReviewOpportunitySummaryDto;
      const sortOrder =
        (dto?.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

      const getComparable = (item: ReviewOpportunitySummaryDto): any => {
        const value = (item as any)[sortBy];
        if (value === null || value === undefined) return undefined;
        if (sortBy === 'challengeName') {
          return String(value).toLowerCase();
        }
        if (sortBy === 'submissionEndDate') {
          try {
            return value instanceof Date
              ? value.getTime()
              : new Date(value).getTime();
          } catch {
            return undefined;
          }
        }
        return Number(value);
      };

      summaries.sort((a, b) => {
        const av = getComparable(a);
        const bv = getComparable(b);

        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return 1; // undefined last
        if (bv === undefined) return -1;

        if (typeof av === 'string' && typeof bv === 'string') {
          const cmp = av.localeCompare(bv);
          return sortOrder === 'asc' ? cmp : -cmp;
        }

        const diff = (av as number) - (bv as number);
        return sortOrder === 'asc' ? diff : -diff;
      });

      // paginate
      const perPage = Math.max(1, Number(dto?.perPage || 10));
      const page = Math.max(1, Number(dto?.page || 1));
      const total = summaries.length;
      const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
      const offset = (page - 1) * perPage;
      const items = summaries.slice(offset, offset + perPage);

      return {
        items,
        metadata: { page, perPage, total, totalPages },
      };
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'fetching review opportunity summary',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Check review opportunity exists or not.
   * @param id review opportunity id
   * @returns existing record
   */
  private async checkExists(id: string) {
    try {
      const existing = await this.prisma.reviewOpportunity.findUnique({
        where: { id },
        include: { applications: true },
      });
      if (!existing || !existing.id) {
        throw new NotFoundException(
          `Review opportunity with ID ${id} not found. Please verify the opportunity ID is correct.`,
        );
      }
      return existing;
    } catch (error) {
      // Re-throw NotFoundException as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `checking existence of review opportunity ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Get challenge data list and put all data into response.
   * @param entityList prisma data list
   * @returns response list
   */
  private async assembleList(
    entityList: any[],
  ): Promise<ReviewOpportunityResponseDto[]> {
    const challengeMap = await this.buildChallengeMap(entityList);
    return this.buildResponseList(entityList, challengeMap);
  }

  private async buildChallengeMap(
    entityList: any[],
  ): Promise<Map<string, ChallengeData>> {
    const challengeIdList: string[] = [
      ...new Set(
        (entityList || [])
          .map((e: any) => e.challengeId as string)
          .filter((id) => !!id),
      ),
    ];

    if (challengeIdList.length === 0) {
      return new Map();
    }

    const challengeList =
      await this.challengeService.getChallenges(challengeIdList);
    const challengeMap = new Map<string, ChallengeData>();
    for (const challenge of challengeList) {
      if (challenge?.id) {
        challengeMap.set(challenge.id, challenge);
      }
    }
    return challengeMap;
  }

  private buildResponseList(
    entityList: any[],
    challengeMap: Map<string, ChallengeData>,
  ): ReviewOpportunityResponseDto[] {
    return (entityList || []).map((e) =>
      this.buildResponse(e, challengeMap.get(e.challengeId)),
    );
  }

  /**
   * Get challenge data and put all data into response.
   * @param entity prisma entity
   * @returns response dto
   */
  private async assembleResult(entity): Promise<ReviewOpportunityResponseDto> {
    const challengeData = await this.challengeService.getChallengeDetail(
      entity.challengeId,
    );
    return this.buildResponse(entity, challengeData);
  }

  /**
   * Put all data into response dto.
   * @param entity prisma entity
   * @param challengeData challenge data from api
   * @returns response dto
   */
  private buildResponse(
    entity: any,
    challengeData?: ChallengeData,
  ): ReviewOpportunityResponseDto {
    const ret = new ReviewOpportunityResponseDto();
    ret.id = entity.id;
    ret.challengeId = entity.challengeId;
    ret.type = entity.type;
    ret.status = entity.status;
    ret.openPositions = entity.openPositions;
    ret.startDate = entity.startDate;
    ret.duration = entity.duration;
    ret.basePayment = entity.basePayment;
    ret.incrementalPayment = entity.incrementalPayment;
    ret.submissions = challengeData?.numOfSubmissions ?? 0;
    ret.challengeName = challengeData?.name ?? '';
    ret.challengeData = challengeData
      ? {
          id: challengeData.legacyId,
          title: challengeData.name,
          type: (challengeData as any)?.type || '',
          typeId: challengeData.typeId ?? '',
          track: challengeData.legacy?.track || challengeData.track || '',
          trackId: challengeData.trackId ?? '',
          subTrack: challengeData.legacy?.subTrack || '',
          technologies: challengeData.tags || [],
          version: '1.0',
          platforms: [''],
        }
      : null;

    // review applications
    if (entity.applications && entity.applications.length > 0) {
      ret.applications = entity.applications.map((e) => ({
        id: e.id,
        opportunityId: entity.id,
        userId: e.userId,
        handle: e.handle,
        role: convertRoleName(e.role),
        status: e.status,
        applicationDate: e.createdAt,
      }));
    }

    // payments
    ret.payments = [];
    const paymentConfig = CommonConfig.reviewPaymentConfig;
    const rolePaymentMap = paymentConfig[entity.type];
    for (const role of Object.keys(rolePaymentMap)) {
      if (rolePaymentMap[role]) {
        ret.payments.push({
          role: convertRoleName(role as ReviewApplicationRole),
          roleId: ReviewApplicationRoleIds[role],
          payment: entity.basePayment * rolePaymentMap[role],
        });
      }
    }
    return ret;
  }

  private findLatestSubmissionPhase(
    phases: SubmissionPhaseSummary[] | undefined,
  ): SubmissionPhaseSummary | null {
    if (!phases || phases.length === 0) {
      return null;
    }

    let latest: SubmissionPhaseSummary | null = null;
    for (const phase of phases) {
      if (!phase) {
        continue;
      }

      if (!latest) {
        latest = phase;
        continue;
      }

      const latestEnd = this.resolvePhaseEndDate(latest);
      const candidateEnd = this.resolvePhaseEndDate(phase);

      if (!latestEnd) {
        if (candidateEnd) {
          latest = phase;
        }
        continue;
      }

      if (!candidateEnd) {
        continue;
      }

      if (candidateEnd.getTime() > latestEnd.getTime()) {
        latest = phase;
      }
    }

    return latest;
  }

  private resolvePhaseEndDate(phase: SubmissionPhaseSummary): Date | null {
    return phase.actualEndDate ?? phase.scheduledEndDate ?? null;
  }
}
