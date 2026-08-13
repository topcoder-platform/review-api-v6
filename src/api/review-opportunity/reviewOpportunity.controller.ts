import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OkResponse, ResponseDto } from 'src/dto/common.dto';
import {
  CreateReviewOpportunityDto,
  QueryReviewOpportunityDto,
  ReviewOpportunityResponseDto,
  ReviewOpportunitySummaryDto,
  UpdateReviewOpportunityDto,
  QueryReviewOpportunitySummaryDto,
} from 'src/dto/reviewOpportunity.dto';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ReviewOpportunityService } from './reviewOpportunity.service';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Request, Response } from 'express';

@ApiTags('Review Opportunity')
@Controller('/review-opportunities')
export class ReviewOpportunityController {
  constructor(private readonly service: ReviewOpportunityService) {}

  @ApiOperation({
    summary: 'Search review opportunity',
    description:
      'Any user should be able to see opportunity. Including anonymous.',
  })
  @ApiQuery({
    name: 'paymentFrom',
    description: 'payment min value',
    type: 'number',
    example: 0.0,
    required: false,
  })
  @ApiQuery({
    name: 'paymentTo',
    description: 'payment max value',
    type: 'number',
    example: 200.0,
    required: false,
  })
  @ApiQuery({
    name: 'startDateFrom',
    description: 'Start date min value',
    type: 'string',
    example: '2022-05-22T12:34:56',
    required: false,
  })
  @ApiQuery({
    name: 'startDateTo',
    description: 'Start date max value',
    type: 'string',
    example: '2022-05-22T12:34:56',
    required: false,
  })
  @ApiQuery({
    name: 'durationFrom',
    description: 'duration min value (seconds)',
    type: 'number',
    example: 86400,
    required: false,
  })
  @ApiQuery({
    name: 'durationTo',
    description: 'duration max value (seconds)',
    type: 'number',
    example: 86400,
    required: false,
  })
  @ApiQuery({
    name: 'numSubmissionsFrom',
    description: 'min number of submissions',
    type: 'number',
    example: 1,
    required: false,
  })
  @ApiQuery({
    name: 'numSubmissionsTo',
    description: 'max number of submissions',
    type: 'number',
    example: 5,
    required: false,
  })
  @ApiQuery({
    name: 'tracks',
    description: 'Challenge tracks (ID or name)',
    type: 'array',
    example: ['CODE'],
    required: false,
  })
  @ApiQuery({
    name: 'types',
    description: 'Challenge types (ID or name)',
    type: 'array',
    example: ['CHALLENGE'],
    required: false,
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'sorting field',
    enum: ['basePayment', 'duration', 'startDate', 'openPositions'],
    type: 'string',
    example: 'basePayment',
    default: 'startDate',
    required: false,
  })
  @ApiQuery({
    name: 'sortOrder',
    description: 'sorting order',
    enum: ['asc', 'desc'],
    type: 'string',
    example: 'asc',
    default: 'asc',
    required: false,
  })
  @ApiQuery({
    name: 'limit',
    description: 'pagination limit',
    type: 'number',
    example: 10,
    default: 10,
    required: false,
  })
  @ApiQuery({
    name: 'offset',
    description: 'pagination offset',
    type: 'number',
    example: 0,
    default: 0,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description:
      'Legacy bare-array review opportunity page. Pagination is supplied in X-Total-Count, X-Page, X-Per-Page, and X-Total-Pages response headers.',
    type: [ReviewOpportunityResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get()
  async search(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
    @Query() dto: QueryReviewOpportunityDto,
  ) {
    const authUser = req['user'] as JwtUser | undefined;
    const result = await this.service.search(dto, authUser);
    response.setHeader('X-Total-Count', String(result.metadata.total));
    response.setHeader('X-Page', String(result.metadata.page));
    response.setHeader('X-Per-Page', String(result.metadata.limit));
    response.setHeader('X-Total-Pages', String(result.metadata.totalPages));
    return result.items;
  }

  @ApiOperation({
    summary: 'Search review opportunities with response metadata',
    description:
      'Metadata-first variant for the Opportunities UI. Supports all filters from GET /review-opportunities and returns the same items inside the standard response envelope.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Standard response envelope whose content is the page and metadata includes total, offset, limit, page, and totalPages.',
    type: ResponseDto<ReviewOpportunityResponseDto[]>,
  })
  @Get('/search')
  /**
   * Returns a metadata-first opportunity search for platform-ui.
   *
   * @param req - Request carrying an optional JWT user.
   * @param dto - Validated search filters.
   * @returns Standard API response containing items and pagination metadata.
   */
  async searchWithMetadata(
    @Req() req: Request,
    @Query() dto: QueryReviewOpportunityDto,
  ) {
    const authUser = req['user'] as JwtUser | undefined;
    const { items, metadata } = await this.service.search(dto, authUser);
    return OkResponse(items, 200, metadata as unknown as Record<string, any>);
  }

  @ApiOperation({
    summary: 'List the authenticated member review applications',
    description:
      'Returns review opportunities on which the current member has applied. Use applicationStatuses to filter PENDING, APPROVED, REJECTED, or CANCELLED applications.',
  })
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description:
      'Standard response envelope with total, offset, limit, page, and totalPages metadata.',
    type: ResponseDto<ReviewOpportunityResponseDto[]>,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Get('/me')
  @Roles(UserRole.Admin, UserRole.Reviewer, UserRole.User)
  /**
   * Returns opportunities on which the authenticated member has applied.
   *
   * @param req - Authenticated request.
   * @param dto - Additional opportunity and application-status filters.
   * @returns Standard API response containing items and pagination metadata.
   */
  async getMyOpportunities(
    @Req() req: Request,
    @Query() dto: QueryReviewOpportunityDto,
  ) {
    const authUser = req['user'] as JwtUser;
    dto.appliedByMe = true;
    const { items, metadata } = await this.service.search(dto, authUser);
    return OkResponse(items, 200, metadata as unknown as Record<string, any>);
  }

  @ApiOperation({
    summary: 'Create review opportunity',
    description: 'Roles: Admin | Copilot',
  })
  @ApiBody({
    description: 'Review opportunity data',
    type: CreateReviewOpportunityDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Review opportunity details',
    type: ResponseDto<ReviewOpportunityResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Post()
  @ApiBearerAuth()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateReviewOpportunity, Scope.AllReviewOpportunity)
  async create(@Req() req: Request, @Body() dto: CreateReviewOpportunityDto) {
    const authUser: JwtUser = req['user'] as JwtUser;
    return OkResponse(await this.service.create(authUser, dto));
  }

  @ApiOperation({
    summary: 'Get review opportunity summary',
    description:
      'Roles: Admin | Scopes: read:review_opportunity, all:review_opportunity',
  })
  @ApiQuery({
    name: 'page',
    description: 'pagination page (1-based)',
    type: 'number',
    example: 1,
    required: false,
    schema: { default: 1 },
  })
  @ApiQuery({
    name: 'perPage',
    description: 'pagination page size',
    type: 'number',
    example: 10,
    required: false,
    schema: { default: 10 },
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'sorting field',
    enum: [
      'challengeName',
      'submissionEndDate',
      'numberOfPendingApplications',
      'numberOfApprovedApplications',
      'numberOfReviewerSpots',
      'numberOfSubmissions',
    ],
    required: false,
    schema: { default: 'submissionEndDate' },
  })
  @ApiQuery({
    name: 'sortOrder',
    description: 'sorting order',
    enum: ['asc', 'desc'],
    required: false,
    schema: { default: 'desc' },
  })
  @ApiResponse({
    status: 200,
    description: 'Review opportunity summary list',
    type: ResponseDto<ReviewOpportunitySummaryDto[]>,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get('/summary')
  @ApiBearerAuth()
  @Roles(UserRole.Admin)
  @Scopes(Scope.ReadReviewOpportunity, Scope.AllReviewOpportunity)
  async summary(@Query() dto: QueryReviewOpportunitySummaryDto) {
    const { items, metadata } = await this.service.getSummary(dto);
    return OkResponse(items, 200, metadata);
  }

  @ApiOperation({
    summary: 'Get review opportunity by id',
    description:
      'Any user should be able to see opportunity. Including anonymous.',
  })
  @ApiParam({
    name: 'id',
    description: 'review opportunity id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review opportunity details',
    type: ResponseDto<ReviewOpportunityResponseDto>,
  })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get('/:id')
  async getById(@Req() req: Request, @Param('id') id: string) {
    const authUser = req['user'] as JwtUser | undefined;
    return OkResponse(await this.service.get(id, authUser));
  }

  @ApiOperation({
    summary: 'Update review opportunity by id',
    description:
      'Roles: Admin | Copilot | Scopes: update:review_opportunity, all:review_opportunity',
  })
  @ApiBody({
    description: 'Review opportunity data',
    type: UpdateReviewOpportunityDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Review opportunity details',
    type: ResponseDto<ReviewOpportunityResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Patch('/:id')
  @ApiBearerAuth()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.UpdateReviewOpportunity, Scope.AllReviewOpportunity)
  async updateById(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateReviewOpportunityDto,
  ) {
    const authUser = req['user'] as JwtUser;
    return OkResponse(await this.service.update(id, dto, authUser));
  }

  @ApiOperation({
    summary: 'Get review opportunity by challenge id',
    description:
      'Any user should be able to see opportunity. Including anonymous.',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'challenge id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review opportunity list',
    type: ResponseDto<ReviewOpportunityResponseDto[]>,
  })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get('/challenge/:challengeId')
  async getByChallengeId(
    @Req() req: Request,
    @Param('challengeId') challengeId: string,
  ) {
    const authUser = req['user'] as JwtUser | undefined;
    return OkResponse(
      await this.service.getByChallengeId(challengeId, authUser),
    );
  }
}
