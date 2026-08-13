import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  convertRoleName,
  ReviewApplicationRole,
  ReviewApplicationRoleIds,
  getReviewApplicationRoles,
} from 'src/dto/reviewApplication.dto';
import {
  CreateReviewOpportunityDto,
  QueryReviewOpportunityDto,
  ReviewOpportunityCanApplyReason,
  ReviewOpportunityResponseDto,
  ReviewOpportunitySearchMetadataDto,
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
import { UserRole } from 'src/shared/enums/userRole.enum';

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

type ChallengeCandidateRow = {
  id: string;
  status: string;
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
   * Searches review opportunities with database pagination and challenge-side
   * filters. The review database returns only lightweight challenge IDs before
   * the challenge database applies track, type, submission-count, title, and
   * lifecycle rules, avoiding hydration of every opportunity. Open work still
   * requires an ACTIVE challenge, while closed/cancelled history remains
   * discoverable after the challenge completes.
   *
   * @param dto - Validated search, sort, and pagination filters.
   * @param authUser - Optional caller used for whitelist and application state.
   * @returns Page items plus explicit total and page metadata.
   * @throws BadRequestException when a caller-specific filter has no caller.
   * @throws InternalServerErrorException when either database query fails.
   */
  async search(
    dto: QueryReviewOpportunityDto,
    authUser?: JwtUser,
  ): Promise<{
    items: ReviewOpportunityResponseDto[];
    metadata: ReviewOpportunitySearchMetadataDto;
  }> {
    try {
      const trackFilterIds = await this.resolveTrackFilters(dto.tracks);
      const typeFilterIds = await this.resolveTypeFilters(dto.types);
      const userId = this.getUserId(authUser);
      if (
        (dto.appliedByMe !== undefined || dto.applicationStatuses?.length) &&
        !userId
      ) {
        throw new BadRequestException({
          message: 'Authentication is required for application filters.',
          code: 'REVIEW_OPPORTUNITY_APPLICATION_FILTER_AUTH_REQUIRED',
        });
      }

      const where: Prisma.reviewOpportunityWhereInput = {
        status: {
          in: (dto.statuses?.length
            ? dto.statuses
            : [ReviewOpportunityStatus.OPEN]) as any,
        },
      };
      if (dto.paymentFrom !== undefined || dto.paymentTo !== undefined) {
        where.basePayment = {
          ...(dto.paymentFrom !== undefined ? { gte: dto.paymentFrom } : {}),
          ...(dto.paymentTo !== undefined ? { lte: dto.paymentTo } : {}),
        };
      }
      if (dto.durationFrom !== undefined || dto.durationTo !== undefined) {
        where.duration = {
          ...(dto.durationFrom !== undefined ? { gte: dto.durationFrom } : {}),
          ...(dto.durationTo !== undefined ? { lte: dto.durationTo } : {}),
        };
      }
      if (dto.startDateFrom || dto.startDateTo) {
        where.startDate = {
          ...(dto.startDateFrom ? { gte: new Date(dto.startDateFrom) } : {}),
          ...(dto.startDateTo ? { lte: new Date(dto.startDateTo) } : {}),
        };
      }
      if (dto.opportunityTypes?.length) {
        where.type = { in: dto.opportunityTypes as any };
      }
      if (dto.challengeIds?.length) {
        where.challengeId = { in: dto.challengeIds };
      }
      if (
        userId &&
        (dto.appliedByMe === true || dto.applicationStatuses?.length)
      ) {
        where.applications = {
          some: {
            userId,
            ...(dto.applicationStatuses?.length
              ? { status: { in: dto.applicationStatuses as any } }
              : {}),
          },
        };
      } else if (userId && dto.appliedByMe === false) {
        where.applications = { none: { userId } };
      }

      const opportunityChallengeRows =
        await this.prisma.reviewOpportunity.findMany({
          where,
          select: { challengeId: true },
          distinct: ['challengeId'],
        });
      const opportunityChallengeIds = opportunityChallengeRows.map(
        (row) => row.challengeId,
      );
      if (!opportunityChallengeIds.length) {
        return this.emptySearchResult(dto);
      }

      const challengeConditions: Prisma.Sql[] = [
        Prisma.sql`c.id IN (${Prisma.join(
          opportunityChallengeIds.map((id) => Prisma.sql`${id}`),
        )})`,
      ];
      if (trackFilterIds.size) {
        challengeConditions.push(
          Prisma.sql`c."trackId" IN (${Prisma.join(
            [...trackFilterIds].map((id) => Prisma.sql`${id}`),
          )})`,
        );
      }
      if (typeFilterIds.size) {
        challengeConditions.push(
          Prisma.sql`c."typeId" IN (${Prisma.join(
            [...typeFilterIds].map((id) => Prisma.sql`${id}`),
          )})`,
        );
      }
      if (dto.numSubmissionsFrom !== undefined) {
        challengeConditions.push(
          Prisma.sql`COALESCE(c."numOfSubmissions", 0) >= ${dto.numSubmissionsFrom}`,
        );
      }
      if (dto.numSubmissionsTo !== undefined) {
        challengeConditions.push(
          Prisma.sql`COALESCE(c."numOfSubmissions", 0) <= ${dto.numSubmissionsTo}`,
        );
      }
      if (dto.search?.trim()) {
        challengeConditions.push(
          Prisma.sql`c.name ILIKE ${`%${dto.search.trim()}%`}`,
        );
      }

      const challengeRows = await this.challengePrisma.$queryRaw<
        ChallengeCandidateRow[]
      >(Prisma.sql`
        SELECT c.id, c.status::text AS status
        FROM "Challenge" c
        WHERE ${Prisma.join(challengeConditions, ' AND ')}
      `);
      const visibleChallengeIds =
        await this.challengeService.filterChallengeIdsByWhitelist(
          authUser,
          challengeRows.map((row) => row.id),
        );
      if (!visibleChallengeIds.length) {
        return this.emptySearchResult(dto);
      }
      const requestedStatuses = dto.statuses?.length
        ? dto.statuses
        : [ReviewOpportunityStatus.OPEN];
      const activeVisibleIds = challengeRows
        .filter(
          (row) =>
            row.status === ChallengeStatus.ACTIVE &&
            visibleChallengeIds.includes(row.id),
        )
        .map((row) => row.id);
      const nonOpenStatuses = requestedStatuses.filter(
        (status) => status !== ReviewOpportunityStatus.OPEN,
      );
      if (requestedStatuses.includes(ReviewOpportunityStatus.OPEN)) {
        where.AND = [
          ...(Array.isArray(where.AND)
            ? where.AND
            : where.AND
              ? [where.AND]
              : []),
          {
            OR: [
              ...(nonOpenStatuses.length
                ? [{ status: { in: nonOpenStatuses as any } }]
                : []),
              {
                status: ReviewOpportunityStatus.OPEN,
                challengeId: { in: activeVisibleIds },
              },
            ],
          },
        ];
      }
      where.challengeId = { in: visibleChallengeIds };

      const limit = Math.max(1, Number(dto.limit ?? 10));
      const offset = Math.max(0, Number(dto.offset ?? 0));
      const orderBy = {
        [dto.sortBy ?? 'startDate']: dto.sortOrder ?? 'asc',
      } as Prisma.reviewOpportunityOrderByWithRelationInput;
      const [entityList, total] = await this.prisma.$transaction([
        this.prisma.reviewOpportunity.findMany({
          where,
          include: {
            applications: userId ? { where: { userId } } : false,
            _count: {
              select: {
                applications: {
                  where: { status: ReviewApplicationStatus.APPROVED },
                },
              },
            },
          },
          orderBy: [orderBy, { id: 'asc' }],
          skip: offset,
          take: limit,
        }),
        this.prisma.reviewOpportunity.count({ where }),
      ]);
      const challengeMap = await this.buildChallengeMap(entityList);
      const items = this.buildResponseList(entityList, challengeMap, authUser);
      return {
        items,
        metadata: {
          total,
          offset,
          limit,
          page: Math.floor(offset / limit) + 1,
          totalPages: total > 0 ? Math.ceil(total / limit) : 0,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
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

  /**
   * Builds a correctly shaped empty result without querying either database.
   *
   * @param dto - Search DTO containing requested pagination values.
   * @returns Empty items and zeroed total metadata.
   */
  private emptySearchResult(dto: QueryReviewOpportunityDto): {
    items: ReviewOpportunityResponseDto[];
    metadata: ReviewOpportunitySearchMetadataDto;
  } {
    const limit = Math.max(1, Number(dto.limit ?? 10));
    const offset = Math.max(0, Number(dto.offset ?? 0));
    return {
      items: [],
      metadata: {
        total: 0,
        offset,
        limit,
        page: Math.floor(offset / limit) + 1,
        totalPages: 0,
      },
    };
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
      return this.buildResponse(entity, challengeData, authUser);
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
   * @param authUser optional caller used for whitelist and eligibility checks
   * @returns response dto
   */
  async get(id: string, authUser?: JwtUser) {
    try {
      const entity = await this.checkExists(id);
      return await this.assembleResult(entity, authUser);
    } catch (error) {
      // Re-throw NotFoundException from checkExists as-is
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
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
   * @param authUser optional authenticated caller used for response eligibility
   * @returns updated and enriched opportunity
   */
  async update(
    id: string,
    dto: UpdateReviewOpportunityDto,
    authUser?: JwtUser,
  ) {
    try {
      await this.checkExists(id);
      await this.prisma.reviewOpportunity.update({
        where: { id },
        data: {
          ...dto,
        },
      });
      const entity = await this.checkExists(id);
      return await this.assembleResult(entity, authUser);
    } catch (error) {
      // Re-throw NotFoundException from checkExists as-is
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
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
   * @param authUser optional caller used for whitelist and eligibility checks
   * @returns review opportunity list
   */
  async getByChallengeId(
    challengeId: string,
    authUser?: JwtUser,
  ): Promise<ReviewOpportunityResponseDto[]> {
    try {
      await this.challengeService.ensureChallengeWhitelistAccess(
        authUser,
        challengeId,
      );
      const entityList = await this.prisma.reviewOpportunity.findMany({
        where: { challengeId },
        include: { applications: true },
      });
      return await this.assembleList(entityList, authUser);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
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
   * @param authUser optional caller used for per-item eligibility
   * @returns response list
   */
  private async assembleList(
    entityList: any[],
    authUser?: JwtUser,
  ): Promise<ReviewOpportunityResponseDto[]> {
    const challengeMap = await this.buildChallengeMap(entityList);
    return this.buildResponseList(entityList, challengeMap, authUser);
  }

  /**
   * Hydrates only the unique challenges represented by the current result page.
   *
   * @param entityList - Review opportunity rows for one page.
   * @returns Challenge data keyed by challenge ID.
   */
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
      await this.challengeService.getChallengeSummaries(challengeIdList);
    const challengeMap = new Map<string, ChallengeData>();
    for (const challenge of challengeList) {
      if (challenge?.id) {
        challengeMap.set(challenge.id, challenge);
      }
    }
    return challengeMap;
  }

  /**
   * Enriches a page of review opportunities with challenge and caller state.
   *
   * @param entityList - Review opportunity rows.
   * @param challengeMap - Hydrated challenges keyed by ID.
   * @param authUser - Optional caller used for eligibility.
   * @returns Enriched response items.
   */
  private buildResponseList(
    entityList: any[],
    challengeMap: Map<string, ChallengeData>,
    authUser?: JwtUser,
  ): ReviewOpportunityResponseDto[] {
    return (entityList || []).map((e) =>
      this.buildResponse(e, challengeMap.get(e.challengeId), authUser),
    );
  }

  /**
   * Get challenge data and put all data into response.
   * @param entity prisma entity
   * @param authUser optional caller used for whitelist and eligibility checks
   * @returns response dto
   */
  private async assembleResult(
    entity,
    authUser?: JwtUser,
  ): Promise<ReviewOpportunityResponseDto> {
    const challengeData = await this.challengeService.getChallengeDetailForUser(
      authUser,
      entity.challengeId,
    );
    return this.buildResponse(entity, challengeData, authUser);
  }

  /**
   * Put all data into response dto.
   * @param entity prisma entity
   * @param challengeData challenge data from api
   * @param authUser optional caller used for application eligibility
   * @returns response dto
   */
  private buildResponse(
    entity: any,
    challengeData?: ChallengeData,
    authUser?: JwtUser,
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
          name: challengeData.name,
          title: challengeData.name,
          description: challengeData.description ?? '',
          overview: challengeData.description ?? '',
          type: challengeData.type ?? '',
          typeId: challengeData.typeId ?? '',
          track: challengeData.legacy?.track || challengeData.track || '',
          trackId: challengeData.trackId ?? '',
          subTrack: challengeData.legacy?.subTrack || '',
          technologies: challengeData.tags || [],
          version: '1.0',
          platforms: [''],
        }
      : null;
    ret.applicationRoles = getReviewApplicationRoles(entity.type);
    ret.defaultApplicationRole = ret.applicationRoles[0];

    // review applications
    const applicationResponses = (entity.applications ?? []).map((e) => ({
      id: e.id,
      opportunityId: entity.id,
      userId: e.userId,
      handle: e.handle,
      role: convertRoleName(e.role),
      status: e.status,
      applicationDate: e.createdAt,
      openReviews: 0,
      latestCompletedReviews: 0,
    }));
    ret.applications = applicationResponses;

    const userId = this.getUserId(authUser);
    ret.myApplications = userId
      ? applicationResponses.filter(
          (application) => String(application.userId) === userId,
        )
      : [];
    ret.approvedApplicationCount = Number(
      entity._count?.applications ??
        applicationResponses.filter(
          (application) =>
            application.status === ReviewApplicationStatus.APPROVED,
        ).length,
    );
    ret.remainingPositions = Math.max(
      0,
      Number(entity.openPositions ?? 0) - ret.approvedApplicationCount,
    );
    ret.canApplyReason = this.resolveCanApplyReason(
      entity,
      challengeData,
      authUser,
      ret.myApplications.length > 0,
      ret.remainingPositions,
    );
    ret.canApply =
      ret.canApplyReason === ReviewOpportunityCanApplyReason.CAN_APPLY;

    // payments
    ret.payments = [];
    const paymentConfig = CommonConfig.reviewPaymentConfig;
    const rolePaymentMap = paymentConfig[entity.type] ?? {};
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

  /**
   * Resolves the authenticated member ID used for caller-specific filters.
   * Machine identities deliberately have no application identity.
   *
   * @param authUser - Optional JWT caller.
   * @returns Normalized member ID, or null for anonymous/M2M callers.
   */
  private getUserId(authUser?: JwtUser): string | null {
    if (authUser?.isMachine || authUser?.userId == null) {
      return null;
    }
    const userId = String(authUser.userId).trim();
    return userId || null;
  }

  /**
   * Produces a stable eligibility reason for the opportunity application CTA.
   *
   * @param entity - Review opportunity and included applications.
   * @param challenge - Associated challenge, when it could be loaded.
   * @param authUser - Optional JWT caller.
   * @param alreadyApplied - Whether this member has any application on the row.
   * @param remainingPositions - Approved-capacity remainder.
   * @returns Stable can-apply reason code.
   */
  private resolveCanApplyReason(
    entity: any,
    challenge: ChallengeData | undefined,
    authUser: JwtUser | undefined,
    alreadyApplied: boolean,
    remainingPositions: number,
  ): ReviewOpportunityCanApplyReason {
    if (!this.getUserId(authUser)) {
      return ReviewOpportunityCanApplyReason.NOT_AUTHENTICATED;
    }
    const roles = (authUser?.roles ?? []).map((role) =>
      String(role).trim().toLowerCase(),
    );
    if (!roles.includes(String(UserRole.Reviewer).toLowerCase())) {
      return ReviewOpportunityCanApplyReason.NOT_REVIEWER;
    }
    if (entity.status !== ReviewOpportunityStatus.OPEN) {
      return ReviewOpportunityCanApplyReason.OPPORTUNITY_CLOSED;
    }
    if (!challenge || challenge.status !== ChallengeStatus.ACTIVE) {
      return ReviewOpportunityCanApplyReason.CHALLENGE_NOT_ACTIVE;
    }
    if (alreadyApplied) {
      return ReviewOpportunityCanApplyReason.ALREADY_APPLIED;
    }
    if (remainingPositions <= 0) {
      return ReviewOpportunityCanApplyReason.NO_OPEN_POSITIONS;
    }
    return ReviewOpportunityCanApplyReason.CAN_APPLY;
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
