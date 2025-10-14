import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewApplicationService } from '../review-application/reviewApplication.service';
import { OkResponse, ResponseDto } from 'src/dto/common.dto';
import { ReviewApplicationResponseDto } from 'src/dto/reviewApplication.dto';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { isAdmin, JwtUser } from 'src/shared/modules/global/jwt.service';

@ApiTags('Review History')
@Controller('/review-history')
export class ReviewHistoryController {
  constructor(private readonly service: ReviewApplicationService) {}

  @ApiOperation({
    summary: 'Get user review history',
    description: 'Only allows this user or admin to check review history.',
  })
  @ApiQuery({
    name: 'range',
    description: 'Data range in days of review history. ',
    type: 'number',
    example: 180,
  })
  @ApiResponse({
    status: 200,
    description: 'Review history',
    type: ResponseDto<ReviewApplicationResponseDto[]>,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 500, description: 'Internal Error' })
  @ApiBearerAuth()
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer, UserRole.User)
  @Get('/:userId')
  async getHistory(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Query('range') range: number,
  ): Promise<ResponseDto<ReviewApplicationResponseDto[]>> {
    // Check user permission
    const authUser: JwtUser = req['user'] as JwtUser;
    console.log(
      `Checking user ${authUser.userId} to get review history of ${userId}`,
    );
    if (authUser.userId != userId && !isAdmin(authUser)) {
      throw new ForbiddenException(
        "You cannot check this user's review history",
      );
    }
    return OkResponse(await this.service.getHistory(userId, range));
  }
}
