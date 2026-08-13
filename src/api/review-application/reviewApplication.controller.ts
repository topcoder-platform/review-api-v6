import {
  Body,
  Controller,
  ForbiddenException,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OkResponse, ResponseDto } from 'src/dto/common.dto';
import {
  CreateReviewApplicationDto,
  QueryMyReviewApplicationDto,
  ReviewApplicationResponseDto,
} from 'src/dto/reviewApplication.dto';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { isAdmin, JwtUser } from 'src/shared/modules/global/jwt.service';
import { ReviewApplicationService } from './reviewApplication.service';

@ApiTags('Review Application')
@Controller('/review-applications')
export class ReviewApplicationController {
  constructor(private readonly service: ReviewApplicationService) {}

  @ApiOperation({
    summary: 'Create review application',
    description: 'Roles: Reviewer',
  })
  @ApiBody({
    description: 'Review application data',
    type: CreateReviewApplicationDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Review application details',
    type: ResponseDto<ReviewApplicationResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Opportunity unavailable' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Post()
  @ApiBearerAuth()
  @Roles(UserRole.Reviewer)
  async create(@Req() req: Request, @Body() dto: CreateReviewApplicationDto) {
    const authUser: JwtUser = req['user'] as JwtUser;
    return OkResponse(await this.service.create(authUser, dto));
  }

  @ApiOperation({
    summary: 'List pending review application',
    description: 'Roles: Admin',
  })
  @ApiResponse({
    status: 200,
    description: 'Review application details',
    type: ResponseDto<ReviewApplicationResponseDto[]>,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get()
  @ApiBearerAuth()
  @Roles(UserRole.Admin)
  async searchPending() {
    return OkResponse(await this.service.listPending());
  }

  @ApiOperation({
    summary: "List the authenticated member's review applications",
    description:
      'Roles: Admin, Reviewer, User. Supports status, role, opportunity, date ordering, and database pagination.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Application page with total, page, perPage, and totalPages metadata.',
    type: ResponseDto<ReviewApplicationResponseDto[]>,
  })
  @ApiBearerAuth()
  @Roles(UserRole.Admin, UserRole.Reviewer, UserRole.User)
  @Get('/me')
  /**
   * Lists the authenticated member's applications with pagination.
   *
   * @param req - Authenticated request containing the member ID.
   * @param dto - Validated application filters and page settings.
   * @returns Standard API response containing applications and total metadata.
   */
  async getMine(
    @Req() req: Request,
    @Query() dto: QueryMyReviewApplicationDto,
  ) {
    const authUser = req['user'] as JwtUser;
    const userId = String(authUser.userId);
    const { items, metadata } = await this.service.listByUserPaginated(
      userId,
      dto,
    );
    return OkResponse(items, 200, metadata as unknown as Record<string, any>);
  }

  @ApiOperation({
    summary: 'Get applications by user ID',
    description: 'Roles: Admin | User (self)',
  })
  @ApiParam({
    name: 'userId',
    description: 'user id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review application details',
    type: ResponseDto<ReviewApplicationResponseDto[]>,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get('/user/:userId')
  @ApiBearerAuth()
  @Roles(UserRole.Admin, UserRole.Reviewer, UserRole.User)
  async getByUserId(@Req() req: Request, @Param('userId') userId: string) {
    // Check user permission. Only admin and user himself can access
    const authUser: JwtUser = req['user'] as JwtUser;
    const tokenUserId =
      authUser.userId == null ? null : String(authUser.userId);
    if (tokenUserId !== userId && !isAdmin(authUser)) {
      throw new ForbiddenException(
        "You cannot retrieve this user's review applications",
      );
    }
    return OkResponse(await this.service.listByUser(userId));
  }

  @ApiOperation({
    summary: 'Get applications by opportunity ID',
    description:
      'All users should be able to see full list. Including anonymous.',
  })
  @ApiParam({
    name: 'opportunityId',
    description: 'review opportunity id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review application details',
    type: ResponseDto<ReviewApplicationResponseDto[]>,
  })
  @ApiResponse({ status: 404, description: 'Not Found' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Get('/opportunity/:opportunityId')
  async getByOpportunityId(@Param('opportunityId') opportunityId: string) {
    return OkResponse(await this.service.listByOpportunity(opportunityId));
  }

  @ApiOperation({
    summary: 'Approve review application by id',
    description: 'Only admin can access.',
  })
  @ApiParam({
    name: 'id',
    description: 'review application id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review application details',
    type: ResponseDto<ReviewApplicationResponseDto>,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not Found' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Roles(UserRole.Admin)
  @Patch('/:id/accept')
  async approveApplication(@Param('id') id: string) {
    await this.service.approve(id);
    return OkResponse({});
  }

  @ApiOperation({
    summary: 'Reject review application by id',
    description: 'Only admin can access.',
  })
  @ApiParam({
    name: 'id',
    description: 'review application id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review application details',
    type: ResponseDto<ReviewApplicationResponseDto>,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not Found' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Roles(UserRole.Admin)
  @Patch('/:id/reject')
  async rejectApplication(@Param('id') id: string) {
    await this.service.reject(id);
    return OkResponse({});
  }

  @ApiOperation({
    summary: 'Reject all pending applications for an opportunity',
    description: 'Only admin can access.',
  })
  @ApiParam({
    name: 'opportunityId',
    description: 'review opportunity id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review application details',
    type: ResponseDto<ReviewApplicationResponseDto[]>,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not Found' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @Roles(UserRole.Admin)
  @Patch('/opportunity/:opportunityId/reject-all')
  async rejectAllPending(@Param('opportunityId') opportunityId: string) {
    await this.service.rejectAllPending(opportunityId);
    return OkResponse({});
  }
}
