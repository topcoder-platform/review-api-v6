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
  ValidationPipe,
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
  SearchScorecardQuery,
} from 'src/dto/scorecard.dto';
import { ChallengeTrack } from 'src/shared/enums/challengeTrack.enum';
import { ScoreCardService } from './scorecard.service';
import { PaginationHeaderInterceptor } from 'src/interceptors/PaginationHeaderInterceptor';
import { $Enums } from '@prisma/client';
import { User } from 'src/shared/decorators/user.decorator';
import { JwtUser } from 'src/shared/modules/global/jwt.service';

@ApiTags('Scorecard')
@ApiBearerAuth()
@Controller('/scorecards')
export class ScorecardController {
  constructor(private readonly scorecardService: ScoreCardService) {}

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
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: ScorecardRequestDto,
    @User() user: JwtUser,
  ): Promise<ScorecardWithGroupResponseDto> {
    return await this.scorecardService.addScorecard(body, user);
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
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: ScorecardRequestDto,
    @User() user: JwtUser,
  ): Promise<ScorecardWithGroupResponseDto> {
    return await this.scorecardService.editScorecard(id, body, user);
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
  async viewScorecard(
    @Param('id') id: string,
  ): Promise<ScorecardWithGroupResponseDto> {
    return await this.scorecardService.viewScorecard(id);
  }

  @Get()
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
    name: 'scorecardType',
    description: 'The scorecard type to filter by',
    example: 'SCREENING',
    required: false,
  })
  @ApiQuery({
    name: 'status',
    description: 'The status to filter by',
    example: 'ACTIVE',
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
    @Query() query: SearchScorecardQuery
  ): Promise<ScorecardPaginatedResponseDto> {
    const { challengeTrack = [], challengeType = [], status = [], scorecardType = [], name, page, perPage} = query;
    

    const result = await this.scorecardService.getScoreCards({
      challengeTrack,
      challengeType,
      name,
      page,
      perPage,
      scorecardType,
      status,
    });
    return result;
  }

  @Post('/:id/clone')
  @Roles(UserRole.Admin)
  @Scopes(Scope.CreateScorecard)
  @ApiOperation({
    summary: 'Clone a scorecard',
    description: 'Roles: Admin | Scopes: create:scorecard',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the scorecard to clone',
    example: 'abc123',
  })
  @ApiResponse({
    status: 201,
    description: 'Scorecard cloned successfully.',
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  async cloneScorecard(
    @Param('id') id: string,
    @User() user: JwtUser,
  ): Promise<ScorecardResponseDto> {
    return this.scorecardService.cloneScorecard(id, user);
  }
}
