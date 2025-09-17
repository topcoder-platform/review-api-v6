import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
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
  UpdateReviewOpportunityDto,
} from 'src/dto/reviewOpportunity.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';

@Injectable()
export class ReviewOpportunityService {
  private readonly logger: Logger = new Logger(ReviewOpportunityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeService: ChallengeApiService,
  ) {}

  /**
   * Search Review Opportunities
   * @param dto query dto
   */
  async search(dto: QueryReviewOpportunityDto) {
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
    // build result with challenge data
    let responseList = await this.assembleList(entityList);
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
    if (dto.tracks && dto.tracks.length > 0) {
      responseList = responseList.filter(
        (r) =>
          r.challengeData &&
          dto.tracks?.includes(r.challengeData['track'] as string),
      );
    }
    if (dto.skills && dto.skills.length > 0) {
      responseList = responseList.filter(
        (r) =>
          r.challengeData &&
          (r.challengeData['technologies'] as string[]).some((e) =>
            dto.skills?.includes(e),
          ),
      );
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
    // make sure challenge exists first
    let challengeData: ChallengeData;
    try {
      challengeData = await this.challengeService.getChallengeDetail(
        dto.challengeId,
      );
    } catch (e) {
      // challenge doesn't exist. Return 400
      this.logger.error("Can't get challenge:", e);
      throw new BadRequestException("Challenge doesn't exist");
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
        'Review opportunity exists for challenge and type',
      );
    }
    const entity = await this.prisma.reviewOpportunity.create({
      data: {
        ...dto,
        createdBy: authUser.userId ?? '',
        updatedBy: authUser.userId ?? '',
      },
    });
    return this.buildResponse(entity, challengeData);
  }

  /**
   * Get opportunity by id
   * @param id opportunity id
   * @returns response dto
   */
  async get(id: string) {
    const entity = await this.checkExists(id);
    return await this.assembleResult(entity);
  }

  /**
   * Update review opportunity by id
   * @param authUser auth user
   * @param id opportunity id
   * @param dto update dto
   */
  async update(authUser: JwtUser, id: string, dto: UpdateReviewOpportunityDto) {
    const updatedBy = authUser.userId ?? '';
    await this.checkExists(id);
    const entity = await this.prisma.reviewOpportunity.update({
      where: { id },
      data: {
        ...dto,
        updatedBy,
      },
    });
    return await this.assembleResult(entity);
  }

  /**
   * Get review opportunities by challenge id
   * @param challengeId challenge id
   * @returns review opportunity list
   */
  async getByChallengeId(
    challengeId: string,
  ): Promise<ReviewOpportunityResponseDto[]> {
    const entityList = await this.prisma.reviewOpportunity.findMany({
      where: { challengeId },
      include: { applications: true },
    });
    return await this.assembleList(entityList);
  }

  /**
   * Check review opportunity exists or not.
   * @param id review opportunity id
   * @returns existing record
   */
  private async checkExists(id: string) {
    const existing = await this.prisma.reviewOpportunity.findUnique({
      where: { id },
      include: { applications: true },
    });
    if (!existing || !existing.id) {
      throw new NotFoundException('Review opportunity not found');
    }
    return existing;
  }

  /**
   * Get challenge data list and put all data into response.
   * @param entityList prisma data list
   * @returns response list
   */
  private async assembleList(
    entityList: any[],
  ): Promise<ReviewOpportunityResponseDto[]> {
    // get challenge id and remove duplicated
    const challengeIdList: string[] = [
      ...new Set(entityList.map((e: any) => e.challengeId as string)),
    ];
    // get all challenge data
    const challengeList =
      await this.challengeService.getChallenges(challengeIdList);
    // build challenge id -> challenge data map
    const challengeMap = new Map();
    challengeList.forEach((c) => challengeMap.set(c.id, c));
    // build response list.
    return entityList.map((e) => {
      return this.buildResponse(e, challengeMap.get(e.challengeId));
    });
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
    challengeData: ChallengeData,
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
    ret.submissions = challengeData.numOfSubmissions ?? 0;
    ret.challengeName = challengeData.name;
    ret.challengeData = {
      id: challengeData.legacyId,
      title: challengeData.name,
      track: challengeData.legacy?.track || '',
      subTrack: challengeData.legacy?.subTrack || '',
      technologies: challengeData.tags || [],
      version: '1.0',
      platforms: [''],
    };

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
}
