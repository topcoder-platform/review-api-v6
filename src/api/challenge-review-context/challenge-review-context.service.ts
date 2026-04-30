import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import {
  CreateChallengeReviewContextDto,
  UpdateChallengeReviewContextDto,
  ChallengeReviewContextResponseDto,
  ChallengeReviewContextStatus,
} from '../../dto/challengeReviewContext.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ChallengeReviewContextStatus as PrismaStatus } from '@prisma/client';

const REGISTRATION_PHASE_NAMES = ['Registration'];

function mapToResponse(row: {
  id: string;
  challengeId: string;
  context: unknown;
  status: string;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}): ChallengeReviewContextResponseDto {
  return {
    id: row.id,
    challengeId: row.challengeId,
    context: (row.context as Record<string, unknown>) ?? {},
    status: row.status as ChallengeReviewContextStatus,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function toPrismaStatus(status: ChallengeReviewContextStatus): PrismaStatus {
  return status as PrismaStatus;
}

@Injectable()
export class ChallengeReviewContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeApiService: ChallengeApiService,
  ) {}

  /**
   * Loads a challenge through the auth-aware challenge reader so whitelist
   * restrictions are enforced before any review-context read or write.
   *
   * @param challengeId - Challenge id to validate.
   * @param authUser - Authenticated request user used for whitelist checks.
   * @returns Challenge details visible to the caller.
   * @throws ForbiddenException when the caller is blocked by challenge whitelist.
   * @throws NotFoundException when the challenge cannot be loaded.
   */
  private async validateChallengeExists(
    challengeId: string,
    authUser: JwtUser,
  ): Promise<ChallengeData> {
    try {
      return await this.challengeApiService.getChallengeDetailForUser(
        authUser,
        challengeId,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new NotFoundException(
        `Challenge with id ${challengeId} not found.`,
      );
    }
  }

  /**
   * Validates that a challenge is currently writable for review context.
   *
   * @param challengeId - Challenge id being written.
   * @param authUser - Authenticated request user used for whitelist checks.
   * @param loadedChallenge - Optional previously loaded challenge details.
   * @throws ForbiddenException when whitelist or challenge phase rules block writing.
   * @throws NotFoundException when the challenge cannot be loaded.
   */
  private async validateChallengeAllowedForWrite(
    challengeId: string,
    authUser: JwtUser,
    loadedChallenge?: ChallengeData,
  ): Promise<void> {
    const challenge =
      loadedChallenge ??
      (await this.validateChallengeExists(challengeId, authUser));
    const isDraft = challenge.status === ChallengeStatus.DRAFT;
    const hasRegistrationPhase =
      challenge.phases?.some(
        (p) => REGISTRATION_PHASE_NAMES.includes(p.name) && p.isOpen,
      ) ?? false;
    if (!isDraft && !hasRegistrationPhase) {
      throw new ForbiddenException(
        'Creating or updating challenge review context is only allowed for challenges in DRAFT status or REGISTRATION phase.',
      );
    }
  }

  async create(
    dto: CreateChallengeReviewContextDto,
    authUser: JwtUser,
  ): Promise<ChallengeReviewContextResponseDto> {
    const challenge = await this.validateChallengeExists(
      dto.challengeId,
      authUser,
    );
    await this.validateChallengeAllowedForWrite(
      dto.challengeId,
      authUser,
      challenge,
    );

    const existing = await this.prisma.challengeReviewContext.findUnique({
      where: { challengeId: dto.challengeId },
    });
    if (existing) {
      throw new ConflictException(
        `A challenge review context already exists for challenge ${dto.challengeId}.`,
      );
    }

    const userId = authUser.userId?.toString() ?? null;
    const record = await this.prisma.challengeReviewContext.create({
      data: {
        challengeId: dto.challengeId,
        context: dto.context as object,
        status: toPrismaStatus(dto.status),
        createdBy: userId,
        updatedBy: userId,
      },
    });

    return mapToResponse(record);
  }

  async getByChallengeId(
    challengeId: string,
    authUser: JwtUser,
  ): Promise<ChallengeReviewContextResponseDto> {
    await this.validateChallengeExists(challengeId, authUser);

    const record = await this.prisma.challengeReviewContext.findUnique({
      where: { challengeId },
    });
    if (!record) {
      throw new NotFoundException(
        `Challenge review context for challenge ${challengeId} not found.`,
      );
    }

    return mapToResponse(record);
  }

  async update(
    challengeId: string,
    dto: UpdateChallengeReviewContextDto,
    authUser: JwtUser,
  ): Promise<ChallengeReviewContextResponseDto> {
    const challenge = await this.validateChallengeExists(challengeId, authUser);
    await this.validateChallengeAllowedForWrite(
      challengeId,
      authUser,
      challenge,
    );

    const existing = await this.prisma.challengeReviewContext.findUnique({
      where: { challengeId },
    });
    if (!existing) {
      throw new NotFoundException(
        `Challenge review context for challenge ${challengeId} not found.`,
      );
    }

    const userId = authUser.userId?.toString() ?? null;
    const updateData: {
      context: object;
      status?: PrismaStatus;
      updatedBy: string | null;
    } = {
      context: dto.context as object,
      updatedBy: userId,
    };
    if (dto.status !== undefined) {
      updateData.status = toPrismaStatus(dto.status);
    }

    const record = await this.prisma.challengeReviewContext.update({
      where: { challengeId },
      data: updateData,
    });

    return mapToResponse(record);
  }
}
