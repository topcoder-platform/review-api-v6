import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles, UserRole } from 'src/shared/guards/tokenRoles.guard';
import {
  ProjectResultResponseDto,
  mockProjectResultResponseDto,
} from 'src/dto/projectResult.dto';

@ApiTags('ProjectResult')
@ApiBearerAuth()
@Controller('/api')
export class ProjectResultController {
  @Get('/projectResult')
  @Roles(UserRole.Reviewer, UserRole.Copilot, UserRole.Submitter)
  @ApiOperation({
    summary: 'Get project results',
    description: 'Retrieve submission results for a given challenge ID',
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
  getProjectResults(
    @Query('challengeId') challengeId: string,
  ): [ProjectResultResponseDto] {
    return [mockProjectResultResponseDto];
  }
}
