import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  AppealRequestDto,
  AppealResponseDto,
  AppealResponseRequestDto,
  AppealResponseResponseDto,
  mapAppealResponseRequestToDto,
} from 'src/dto/appeal.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';
import { ChallengeApiService } from '../../shared/modules/global/challenge.service';
import { JwtUser, isAdmin } from '../../shared/modules/global/jwt.service';
import { Request } from 'express';

@ApiTags('Appeal')
@ApiBearerAuth()
@Controller('/appeals')
export class AppealController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly challengeApiService: ChallengeApiService,
  ) {
    this.logger = LoggerService.forRoot('AppealController');
  }

  @Post()
  @Roles(UserRole.User, UserRole.Admin)
  @Scopes(Scope.CreateAppeal)
  @ApiOperation({
    summary: 'Create an appeal for a specific review item comment',
    description:
      'Roles: User (only for the review of their own submission) | Admin | Scopes: create:appeal',
  })
  @ApiBody({ description: 'Appeal request body', type: AppealRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Appeal created successfully.',
    type: AppealResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createAppeal(
    @Req() req: Request,
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    this.logger.log(`Creating appeal`);
    const authUser = req['user'] as JwtUser;
    try {
      // Get challengeId by following the relationship chain
      const reviewItemComment =
        await this.prisma.reviewItemComment.findUniqueOrThrow({
          where: { id: body.reviewItemCommentId },
          include: {
            reviewItem: {
              include: {
                review: {
                  include: {
                    submission: {
                      select: { challengeId: true, memberId: true },
                    },
                  },
                },
              },
            },
          },
        });

      const submission = reviewItemComment.reviewItem.review.submission;
      const challengeId = submission?.challengeId;
      if (!challengeId) {
        throw new BadRequestException({
          message: `No challengeId found for reviewItemComment ${body.reviewItemCommentId}`,
          code: 'MISSING_CHALLENGE_ID',
        });
      }

      this.ensureAppealPermission(
        authUser,
        submission?.memberId,
        'create',
        'APPEAL_CREATE_FORBIDDEN',
      );

      // Validate that appeal submission is allowed for this challenge
      await this.challengeApiService.validateAppealSubmission(challengeId);

      const data = await this.prisma.appeal.create({
        data: { ...body },
      });
      this.logger.log(`Appeal created with ID: ${data.id}`);
      return data as AppealResponseDto;
    } catch (error) {
      // Handle phase validation errors
      if (
        error.message &&
        error.message.includes('Appeals cannot be submitted')
      ) {
        throw new BadRequestException({
          message: error.message,
          code: 'PHASE_VALIDATION_ERROR',
        });
      }

      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating appeal for review item comment: ${body.reviewItemCommentId}`,
        body,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  @Patch('/:appealId')
  @Roles(UserRole.User, UserRole.Admin)
  @Scopes(Scope.UpdateAppeal)
  @ApiOperation({
    summary: 'Update an appeal',
    description:
      'Roles: User (only for the review of their own submission) | Admin | Scopes: update:appeal',
  })
  @ApiParam({ name: 'appealId', description: 'The ID of the appeal to update' })
  @ApiBody({ description: 'Appeal request body', type: AppealRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Appeal updated successfully.',
    type: AppealResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal not found.' })
  async updateAppeal(
    @Req() req: Request,
    @Param('appealId') appealId: string,
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    this.logger.log(`Updating appeal with ID: ${appealId}`);
    const authUser = req['user'] as JwtUser;
    try {
      const existingAppeal = await this.getAppealContext(appealId);

      if (!existingAppeal) {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Please verify the appeal ID is correct.`,
          code: 'RECORD_NOT_FOUND',
        });
      }

      this.ensureAppealPermission(
        authUser,
        existingAppeal.reviewItemComment.reviewItem.review.submission?.memberId,
        'update',
        'APPEAL_UPDATE_FORBIDDEN',
      );

      if (
        !authUser?.isMachine &&
        !isAdmin(authUser) &&
        body.resourceId !== existingAppeal.resourceId
      ) {
        throw new ForbiddenException({
          message: 'Submitters cannot change the resourceId for an appeal.',
          code: 'APPEAL_RESOURCE_UPDATE_FORBIDDEN',
          details: {
            appealId,
            requestedResourceId: body.resourceId,
            existingResourceId: existingAppeal.resourceId,
          },
        });
      }

      if (
        body.reviewItemCommentId !== existingAppeal.reviewItemCommentId &&
        !authUser?.isMachine &&
        !isAdmin(authUser)
      ) {
        const newComment = await this.getReviewItemCommentContext(
          body.reviewItemCommentId,
        );

        if (!newComment) {
          throw new NotFoundException({
            message: `Review item comment with ID ${body.reviewItemCommentId} was not found.`,
            code: 'REVIEW_ITEM_COMMENT_NOT_FOUND',
          });
        }

        this.ensureAppealPermission(
          authUser,
          newComment.reviewItem.review.submission?.memberId,
          'update',
          'APPEAL_UPDATE_FORBIDDEN',
        );
      }

      const data = await this.prisma.appeal.update({
        where: { id: appealId },
        data: { ...body },
      });
      this.logger.log(`Appeal updated successfully: ${appealId}`);
      return data as AppealResponseDto;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Please verify the appeal ID is correct.`,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  @Delete('/:appealId')
  @Roles(UserRole.User, UserRole.Admin)
  @Scopes(Scope.DeleteAppeal)
  @ApiOperation({
    summary: 'Delete an appeal',
    description:
      'Roles: User (only for the review of their own submission) | Admin | Scopes: delete:appeal',
  })
  @ApiParam({ name: 'appealId', description: 'The ID of the appeal to delete' })
  @ApiResponse({ status: 200, description: 'Appeal deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal not found.' })
  async deleteAppeal(@Req() req: Request, @Param('appealId') appealId: string) {
    this.logger.log(`Deleting appeal with ID: ${appealId}`);
    const authUser = req['user'] as JwtUser;
    try {
      const existingAppeal = await this.getAppealContext(appealId);

      if (!existingAppeal) {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Cannot delete a non-existent appeal.`,
          code: 'RECORD_NOT_FOUND',
        });
      }

      this.ensureAppealPermission(
        authUser,
        existingAppeal.reviewItemComment.reviewItem.review.submission?.memberId,
        'delete',
        'APPEAL_DELETE_FORBIDDEN',
      );

      await this.prisma.appeal.delete({
        where: { id: appealId },
      });
      this.logger.log(`Appeal deleted successfully: ${appealId}`);
      return { message: `Appeal ${appealId} deleted successfully.` };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Cannot delete a non-existent appeal.`,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private ensureAppealPermission(
    authUser: JwtUser,
    submissionMemberId: string | null | undefined,
    action: 'create' | 'update' | 'delete',
    errorCode: string,
  ): void {
    if (!authUser) {
      throw new ForbiddenException({
        message: `Only the submission owner or an admin can ${action} this appeal.`,
        code: errorCode,
      });
    }

    if (authUser.isMachine || isAdmin(authUser)) {
      return;
    }

    const requesterId = authUser.userId ? String(authUser.userId) : '';
    const ownerId = submissionMemberId ? String(submissionMemberId) : '';

    if (!requesterId || !ownerId || requesterId !== ownerId) {
      throw new ForbiddenException({
        message: `Only the submission owner or an admin can ${action} this appeal.`,
        code: errorCode,
        details: {
          action,
          requesterId,
          submissionMemberId,
        },
      });
    }
  }

  private async getAppealContext(appealId: string) {
    return this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: {
        reviewItemComment: {
          include: {
            reviewItem: {
              include: {
                review: {
                  include: {
                    submission: {
                      select: { id: true, memberId: true, challengeId: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  private async getReviewItemCommentContext(reviewItemCommentId: string) {
    return this.prisma.reviewItemComment.findUnique({
      where: { id: reviewItemCommentId },
      include: {
        reviewItem: {
          include: {
            review: {
              include: {
                submission: {
                  select: { id: true, memberId: true, challengeId: true },
                },
              },
            },
          },
        },
      },
    });
  }

  @Post('/:appealId/response')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer) // Expand the permission to Admin and Copilots for now
  @Scopes(Scope.CreateAppealResponse)
  @ApiOperation({
    summary: 'Create a response for an appeal',
    description: 'Roles: Reviewer | Scopes: create:appeal-response',
  })
  @ApiParam({
    name: 'appealId',
    description: 'The ID of the appeal to respond to',
  })
  @ApiBody({
    description: 'Appeal response request body',
    type: AppealResponseRequestDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Appeal response created successfully.',
    type: AppealResponseResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal response not found.' })
  async createAppealResponse(
    @Param('appealId') appealId: string,
    @Body() body: AppealResponseRequestDto,
  ): Promise<AppealResponseResponseDto> {
    this.logger.log(`Creating response for appeal ID: ${appealId}`);
    try {
      // Get challengeId by following the relationship chain from appeal
      const appeal = await this.prisma.appeal.findUniqueOrThrow({
        where: { id: appealId },
        include: {
          reviewItemComment: {
            include: {
              reviewItem: {
                include: {
                  review: {
                    include: {
                      submission: {
                        select: { challengeId: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const challengeId =
        appeal.reviewItemComment.reviewItem.review.submission?.challengeId;
      if (!challengeId) {
        throw new BadRequestException({
          message: `No challengeId found for appeal ${appealId}`,
          code: 'MISSING_CHALLENGE_ID',
        });
      }

      // Validate that appeal response submission is allowed for this challenge
      await this.challengeApiService.validateAppealResponseSubmission(
        challengeId,
      );

      const data = await this.prisma.appeal.update({
        where: { id: appealId },
        data: {
          appealResponse: {
            create: mapAppealResponseRequestToDto(body),
          },
        },
        include: {
          appealResponse: true,
        },
      });
      this.logger.log(`Appeal response created for appeal ID: ${appealId}`);
      return data.appealResponse as AppealResponseResponseDto;
    } catch (error) {
      // Handle phase validation errors
      if (
        error.message &&
        error.message.includes('Appeal responses cannot be submitted')
      ) {
        throw new BadRequestException({
          message: error.message,
          code: 'PHASE_VALIDATION_ERROR',
        });
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating response for appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Cannot create response for a non-existent appeal.`,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  @Patch('/response/:appealResponseId')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer) // Expand the permission to Admin and Copilots for now
  @Scopes(Scope.UpdateAppealResponse)
  @ApiOperation({
    summary: 'Update a response for an appeal',
    description: 'Roles: Reviewer | Scopes: update:appeal-response',
  })
  @ApiParam({
    name: 'appealResponseId',
    description: 'The ID of the appeal response to update the response for',
  })
  @ApiBody({
    description: 'Appeal response request body',
    type: AppealResponseRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Appeal response updated successfully.',
    type: AppealResponseResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal response not found.' })
  async updateAppealResponse(
    @Param('appealResponseId') appealResponseId: string,
    @Body() body: AppealResponseRequestDto,
  ): Promise<AppealResponseRequestDto> {
    this.logger.log(`Updating appeal response with ID: ${appealResponseId}`);
    try {
      const data = await this.prisma.appealResponse.update({
        where: { id: appealResponseId },
        data: mapAppealResponseRequestToDto(body),
      });
      this.logger.log(
        `Appeal response updated successfully: ${appealResponseId}`,
      );
      return data as AppealResponseRequestDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating appeal response ${appealResponseId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal response with ID ${appealResponseId} was not found. Please verify the appeal response ID is correct.`,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  @Get('/')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer, UserRole.User)
  @Scopes(Scope.ReadAppeal)
  @ApiOperation({
    summary: 'Get appeals',
    description: 'Roles: Admin, Reviewer, User, Copilot | Scopes: read:appeal',
  })
  @ApiQuery({
    name: 'resourceId',
    description: 'The ID of the resource to filter by',
    required: false,
  })
  @ApiQuery({
    name: 'reviewId',
    description: 'The ID of the review to filter by',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'List of matching appeals',
    type: [AppealResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getAppeals(
    @Query('resourceId') resourceId?: string,
    @Query('reviewId') reviewId?: string,
    @Query() paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<AppealResponseDto>> {
    this.logger.log(
      `Getting appeals with filters - resourceId: ${resourceId}, reviewId: ${reviewId}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      // Build where clause for filtering
      const whereClause: any = {};
      if (resourceId) whereClause.resourceId = resourceId;
      if (reviewId) {
        whereClause.reviewItemComment = {
          reviewItem: {
            reviewId: reviewId,
          },
        };
      }

      const [appeals, totalCount] = await Promise.all([
        this.prisma.appeal.findMany({
          where: whereClause,
          skip,
          take: perPage,
          include: {
            reviewItemComment: {
              include: {
                reviewItem: true,
              },
            },
            appealResponse: true,
          },
        }),
        this.prisma.appeal.count({
          where: whereClause,
        }),
      ]);

      this.logger.log(
        `Found ${appeals.length} appeals (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: appeals.map((appeal) => ({
          id: appeal.id,
          resourceId: appeal.resourceId,
          reviewItemCommentId: appeal.reviewItemCommentId,
          content: appeal.content,
          createdAt: appeal.createdAt,
          createdBy: appeal.createdBy,
          updatedAt: appeal.updatedAt,
          updatedBy: appeal.updatedBy,
          legacyId: appeal.legacyId,
        })) as AppealResponseDto[],
        meta: {
          page,
          perPage,
          totalCount,
          totalPages: Math.ceil(totalCount / perPage),
        },
      };
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching appeals with filters - resourceId: ${resourceId}, reviewId: ${reviewId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }
}
