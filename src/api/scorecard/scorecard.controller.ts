import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles, UserRole } from 'src/shared/guards/tokenRoles.guard';
import {
  ScorecardRequestDto,
  ScorecardResponseDto,
  sampleScorecardResponse,
} from 'src/dto/scorecard.dto';

@ApiTags('Scorecard')
@ApiBearerAuth()
@Controller('/api/scorecards')
export class ScorecardController {
  @Post()
  @Roles(UserRole.Admin)
  @ApiOperation({ summary: 'Add a new scorecard', description: 'Roles: Admin' })
  @ApiBody({ description: 'Scorecard data', type: ScorecardRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Scorecard added successfully.',
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  addScorecard(@Body() body: ScorecardRequestDto): ScorecardResponseDto {
    return sampleScorecardResponse;
  }

  @Put('/:id')
  @Roles(UserRole.Admin)
  @ApiOperation({
    summary: 'Edit an existing scorecard',
    description: 'Roles: Admin',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the scorecard',
    example: 'abc123',
  })
  @ApiBody({ description: 'Scorecard data', type: ScorecardRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Scorecard updated successfully.',
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  editScorecard(
    @Param('id') id: string,
    @Body() body: ScorecardRequestDto,
  ): ScorecardResponseDto {
    return sampleScorecardResponse;
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  @ApiOperation({ summary: 'Delete a scorecard', description: 'Roles: Admin' })
  @ApiParam({
    name: 'id',
    description: 'The ID of the scorecard',
    example: 'abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Scorecard deleted successfully.',
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  deleteScorecard(@Param('id') id: string) {
    return { message: `Scorecard ${id} deleted successfully.` };
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'View a scorecard',
    description: 'Roles: All Topcoder',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the scorecard',
    example: 'abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Scorecard retrieved successfully.',
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  viewScorecard(@Param('id') id: string): ScorecardResponseDto {
    return sampleScorecardResponse;
  }

  @Get()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @ApiOperation({
    summary: 'Search scorecards',
    description: 'Search by challenge track, challenge type, or name',
  })
  @ApiQuery({
    name: 'challengeTrack',
    description: 'The challenge track to filter by',
    example: 'Data Science',
    required: false,
  })
  @ApiQuery({
    name: 'challengeType',
    description: 'The challenge type to filter by',
    example: 'Hackathon',
    required: false,
  })
  @ApiQuery({
    name: 'name',
    description: 'The challenge name to filter by (partial match)',
    example: 'name',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'List of matching scorecards',
    type: [ScorecardResponseDto],
  })
  searchScorecards(
    @Query('challengeTrack') challengeTrack?: string,
    @Query('challengeType') cchallengeType?: string,
    @Query('name') name?: string,
  ) {
    return [sampleScorecardResponse];
  }
}
