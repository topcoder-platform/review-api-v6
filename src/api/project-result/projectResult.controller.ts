import {
  Controller,
  Get,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import { ProjectResultResponseDto } from 'src/dto/projectResult.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';

@ApiTags('ProjectResult')
@ApiBearerAuth()
@Controller('/projectResult')
export class ProjectResultController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {
    this.logger = LoggerService.forRoot('ProjectResultController');
  }

  @Get()
  @Roles(UserRole.Reviewer, UserRole.Copilot, UserRole.User, UserRole.Admin)
  @Scopes(Scope.ReadProjectResult)
  @ApiOperation({
    summary: 'Get project results',
    description: 'Roles: Reviewer, Copilot, User | Scopes: read:project-result',
  })
  @ApiQuery({
    name: 'challengeId',
    description: 'The ID of the challenge to filter by',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Project results retrieved successfully.',
    type: [ProjectResultResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getProjectResults(
    @Query('challengeId') challengeId: string,
    @Query() paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<ProjectResultResponseDto>> {
    this.logger.log(`Getting project results for challengeId: ${challengeId}`);

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      const [projectResults, totalCount] = await Promise.all([
        this.prisma.challengeResult.findMany({
          where: { challengeId },
          skip,
          take: perPage,
        }),
        this.prisma.challengeResult.count({
          where: { challengeId },
        }),
      ]);

      this.logger.log(
        `Found ${projectResults.length} project results (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: projectResults as ProjectResultResponseDto[],
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
        `fetching project results for challenge ${challengeId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }
}
