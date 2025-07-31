import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
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
    summary: 'Get applications by user ID',
    description: 'Roles: Admin | Reviewer',
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
  @Roles(UserRole.Admin, UserRole.Reviewer)
  async getByUserId(@Req() req: Request, @Param('userId') userId: string) {
    // Check user permission. Only admin and user himself can access
    const authUser: JwtUser = req['user'] as JwtUser;
    if (authUser.userId !== userId && !isAdmin(authUser)) {
      throw new ForbiddenException(
        "You cannot check this user's review applications",
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
  async approveApplication(@Req() req: Request, @Param('id') id: string) {
    const authUser: JwtUser = req['user'] as JwtUser;
    await this.service.approve(authUser, id);
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
  async rejectApplication(@Req() req: Request, @Param('id') id: string) {
    const authUser: JwtUser = req['user'] as JwtUser;
    await this.service.reject(authUser, id);
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
  async rejectAllPending(
    @Req() req: Request,
    @Param('opportunityId') opportunityId: string,
  ) {
    const authUser: JwtUser = req['user'] as JwtUser;
    await this.service.rejectAllPending(authUser, opportunityId);
    return OkResponse({});
  }
}
