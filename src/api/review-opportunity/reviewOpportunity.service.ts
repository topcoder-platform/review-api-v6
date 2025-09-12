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
  UpdateReviewOpportunityDto,
} from 'src/dto/reviewOpportunity.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';

@Injectable()
export class ReviewOpportunityService {
  private readonly logger: Logger = new Logger(ReviewOpportunityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeService: ChallengeApiService,
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
      track: challengeData.legacy?.track || challengeData.track || '',
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
        applicationDate: e.createdBy,
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
