import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
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
  UpdateReviewOpportunityDto,
} from 'src/dto/reviewOpportunity.dto';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ReviewOpportunityService } from './reviewOpportunity.service';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';

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
    description: 'Challenge tracks',
    type: 'array',
    example: ['CODE'],
    required: false,
  })
  @ApiQuery({
    name: 'skills',
    description: 'Skills of challenges',
    type: 'array',
    example: ['TypeScript'],
    required: false,
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'sorting field',
    enum: ['basePayment', 'duration', 'startDate'],
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
    description: 'Review opportunity list',
    type: ResponseDto<ReviewOpportunityResponseDto[]>,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get()
  async search(@Query() dto: QueryReviewOpportunityDto) {
    return await this.service.search(dto);
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
  async getById(@Param('id') id: string) {
    return OkResponse(await this.service.get(id));
  }

  @ApiOperation({
    summary: 'Update review opportunity by id',
    description:
      'Any user should be able to see opportunity. Including anonymous.',
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
    const authUser: JwtUser = req['user'] as JwtUser;
    return OkResponse(await this.service.update(authUser, id, dto));
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
  async getByChallengeId(@Param('challengeId') challengeId: string) {
    return OkResponse(await this.service.getByChallengeId(challengeId));
  }
}
