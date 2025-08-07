import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
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
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  ScorecardPaginatedResponseDto,
  ScorecardRequestDto,
  ScorecardResponseDto,
  ScorecardWithGroupResponseDto,
  mapScorecardRequestToDto,
} from 'src/dto/scorecard.dto';
import { ChallengeTrack } from 'src/shared/enums/challengeTrack.enum';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { ScoreCardService } from './scorecard.service';
import { PaginationHeaderInterceptor } from 'src/interceptors/PaginationHeaderInterceptor';

@ApiTags('Scorecard')
@ApiBearerAuth()
@Controller('/scorecards')
export class ScorecardController {
  constructor(private readonly prisma: PrismaService, private readonly scorecardService: ScoreCardService) {}

  @Post()
  @Roles(UserRole.Admin)
  @Scopes(Scope.CreateScorecard)
  @ApiOperation({
    summary: 'Add a new scorecard',
    description: 'Roles: Admin | Scopes: create:scorecard',
  })
  @ApiBody({ description: 'Scorecard data', type: ScorecardRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Scorecard added successfully.',
    type: ScorecardWithGroupResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async addScorecard(
    @Body() body: ScorecardRequestDto,
  ): Promise<ScorecardWithGroupResponseDto> {
    return await this.scorecardService.addScorecard(body);
  }

  @Put('/:id')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateScorecard)
  @ApiOperation({
    summary: 'Edit an existing scorecard',
    description: 'Roles: Admin | Scopes: update:scorecard',
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
    type: ScorecardWithGroupResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  async editScorecard(
    @Param('id') id: string,
    @Body() body: ScorecardWithGroupResponseDto,
  ): Promise<ScorecardWithGroupResponseDto> {    
    return await this.scorecardService.editScorecard(id, body);
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  @Scopes(Scope.DeleteScorecard)
  @ApiOperation({
    summary: 'Delete a scorecard',
    description: 'Roles: Admin | Scopes: delete:scorecard',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the scorecard',
    example: 'abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Scorecard deleted successfully.',
    type: ScorecardWithGroupResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  async deleteScorecard(@Param('id') id: string) {
    return await this.scorecardService.deleteScorecard(id);
  }

  @Get('/:id')
  @Scopes(Scope.ReadScorecard)
  @ApiOperation({
    summary: 'View a scorecard',
    description: 'Scopes: read:scorecard',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the scorecard',
    example: 'abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Scorecard retrieved successfully.',
    type: ScorecardWithGroupResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  async viewScorecard(@Param('id') id: string): Promise<ScorecardWithGroupResponseDto> {
    return await this.scorecardService.viewScorecard(id);
  }

  @Get()
  @Roles(UserRole.Admin)
  @Scopes(Scope.ReadScorecard)
  @ApiOperation({
    summary: 'Search scorecards',
    description:
      'Search by challenge track, challenge type, or name. Roles: Admin, Copilot | Scopes: read:scorecard',
  })
  @ApiQuery({
    name: 'challengeTrack',
    description: 'The challenge track to filter by',
    example: 'Data Science',
    required: false,
    enum: ChallengeTrack,
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
  @ApiQuery({
    name: 'page',
    description: 'Page number (starts from 1)',
    required: false,
    type: Number,
    example: 1,
  })
  @ApiQuery({
    name: 'perPage',
    description: 'Number of items per page',
    required: false,
    type: Number,
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'List of matching scorecards',
    type: [ScorecardResponseDto],
  })
  @UseInterceptors(PaginationHeaderInterceptor)
  async searchScorecards(
    @Query('challengeTrack') challengeTrack?: ChallengeTrack | ChallengeTrack[],
    @Query('challengeType') challengeType?: string | string[],
    @Query('name') name?: string,
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
  ): Promise<ScorecardPaginatedResponseDto> {
    const challengeTrackArray = Array.isArray(challengeTrack)
    ? challengeTrack
    : challengeTrack
    ? [challengeTrack]
    : [];
    const challengeTypeArray = Array.isArray(challengeType)
    ? challengeType
    : challengeType
    ? [challengeType]
    : [];
    const result = await this.scorecardService.getScoreCards({
      challengeTrack: challengeTrackArray,
      challengeType: challengeTypeArray,
      name,
      page,
      perPage,
    });
    return result;
  }
}
