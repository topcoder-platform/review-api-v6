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
  InternalServerErrorException,
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
  mapAppealRequestToDto,
  mapAppealResponseRequestToDto,
} from 'src/dto/appeal.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';

@ApiTags('Appeal')
@ApiBearerAuth()
@Controller('/appeals')
export class AppealController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {
    this.logger = LoggerService.forRoot('AppealController');
  }

  @Post()
  @Roles(UserRole.User)
  @Scopes(Scope.CreateAppeal)
  @ApiOperation({
    summary: 'Create an appeal for a specific review item comment',
    description: 'Roles: User | Scopes: create:appeal',
  })
  @ApiBody({ description: 'Appeal request body', type: AppealRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Appeal created successfully.',
    type: AppealResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createAppeal(
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    this.logger.log(`Creating appeal`);
    try {
      const data = await this.prisma.appeal.create({
        data: mapAppealRequestToDto(body),
      });
      this.logger.log(`Appeal created with ID: ${data.id}`);
      return data as AppealResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'creating appeal',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Patch('/:appealId')
  @Roles(UserRole.User)
  @Scopes(Scope.UpdateAppeal)
  @ApiOperation({
    summary: 'Update an appeal',
    description: 'Roles: User | Scopes: update:appeal',
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
    @Param('appealId') appealId: string,
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    this.logger.log(`Updating appeal with ID: ${appealId}`);
    try {
      const data = await this.prisma.appeal.update({
        where: { id: appealId },
        data: mapAppealRequestToDto(body),
      });
      this.logger.log(`Appeal updated successfully: ${appealId}`);
      return data as AppealResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Delete('/:appealId')
  @Roles(UserRole.User)
  @Scopes(Scope.DeleteAppeal)
  @ApiOperation({
    summary: 'Delete an appeal',
    description: 'Roles: User | Scopes: delete:appeal',
  })
  @ApiParam({ name: 'appealId', description: 'The ID of the appeal to delete' })
  @ApiResponse({ status: 200, description: 'Appeal deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal not found.' })
  async deleteAppeal(@Param('appealId') appealId: string) {
    this.logger.log(`Deleting appeal with ID: ${appealId}`);
    try {
      await this.prisma.appeal.delete({
        where: { id: appealId },
      });
      this.logger.log(`Appeal deleted successfully: ${appealId}`);
      return { message: `Appeal ${appealId} deleted successfully.` };
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Post('/:appealId/response')
  @Roles(UserRole.Reviewer)
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
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating response for appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Patch('/response/:appealResponseId')
  @Roles(UserRole.Reviewer)
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
          message: `Appeal response with ID ${appealResponseId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Get('/')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.ReadAppeal)
  @ApiOperation({
    summary: 'Get appeals',
    description: 'Roles: Admin, Copilot | Scopes: read:appeal',
  })
  @ApiQuery({
    name: 'resourceId',
    description: 'The ID of the resource to filter by',
    required: false,
  })
  @ApiQuery({
    name: 'challengeId',
    description: 'The ID of the challenge to filter by',
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
    @Query('challengeId') challengeId?: string,
    @Query('reviewId') reviewId?: string,
    @Query() paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<AppealResponseDto>> {
    this.logger.log(
      `Getting appeals with filters - resourceId: ${resourceId}, challengeId: ${challengeId}, reviewId: ${reviewId}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      // Build where clause for filtering
      const whereClause: any = {};
      if (resourceId) whereClause.resourceId = resourceId;
      if (challengeId) whereClause.challengeId = challengeId;
      if (reviewId) whereClause.appealId = reviewId;

      const [appeals, totalCount] = await Promise.all([
        this.prisma.appealResponse.findMany({
          where: whereClause,
          skip,
          take: perPage,
        }),
        this.prisma.appealResponse.count({
          where: whereClause,
        }),
      ]);

      this.logger.log(
        `Found ${appeals.length} appeals (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: appeals.map((appeal) => ({
          ...appeal,
          reviewItemCommentId: '',
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
        'fetching appeals',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }
}
