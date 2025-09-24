import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { MyReviewService } from './myReview.service';
import { MyReviewFilterDto, MyReviewSummaryDto } from 'src/dto/my-review.dto';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';

@ApiTags('My Reviews')
@ApiBearerAuth()
@Controller('/my-reviews')
export class MyReviewController {
  constructor(private readonly myReviewService: MyReviewService) {}

  @Get()
  @Roles(
    UserRole.Admin,
    UserRole.Reviewer,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.ProjectManager,
    UserRole.User,
  )
  @Scopes(Scope.ReadReview)
  @ApiOperation({
    summary: 'Return active challenges assigned to the authenticated user',
    description:
      'Lists active challenges and review progress for the authenticated user. Admins receive all active challenges.',
  })
  @ApiQuery({
    name: 'challengeTypeId',
    required: false,
    description: 'Filter by challenge type identifier',
  })
  @ApiQuery({
    name: 'challengeTypeName',
    required: false,
    description: 'Filter by exact challenge type name (case-insensitive)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active challenges for the requesting user',
    type: [MyReviewSummaryDto],
  })
  async getMyReviews(
    @Req() req: Request,
    @Query() filters: MyReviewFilterDto,
  ): Promise<MyReviewSummaryDto[]> {
    const authUser = req['user'];
    return this.myReviewService.getMyReviews(authUser, filters);
  }
}
