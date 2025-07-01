import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  InternalServerErrorException,
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
  ScorecardRequestDto,
  ScorecardResponseDto,
  mapScorecardRequestToDto,
} from 'src/dto/scorecard.dto';
import { ChallengeTrack } from 'src/shared/enums/challengeTrack.enum';
import { PrismaService } from '../../shared/modules/global/prisma.service';

@ApiTags('Scorecard')
@ApiBearerAuth()
@Controller('/api/scorecards')
export class ScorecardController {
  constructor(private readonly prisma: PrismaService) {}

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
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async addScorecard(
    @Body() body: ScorecardRequestDto,
  ): Promise<ScorecardResponseDto> {
    const data = await this.prisma.scorecard.create({
      data: mapScorecardRequestToDto(body),
      include: {
        scorecardGroups: {
          include: {
            sections: {
              include: {
                questions: true,
              },
            },
          },
        },
      },
    });
    return data as ScorecardResponseDto;
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
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  async editScorecard(
    @Param('id') id: string,
    @Body() body: ScorecardRequestDto,
  ): Promise<ScorecardResponseDto> {
    console.log(JSON.stringify(body));

    const data = await this.prisma.scorecard
      .update({
        where: { id },
        data: mapScorecardRequestToDto(body),
        include: {
          scorecardGroups: {
            include: {
              sections: {
                include: {
                  questions: true,
                },
              },
            },
          },
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Scorecard not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as ScorecardResponseDto;
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
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  async deleteScorecard(@Param('id') id: string) {
    await this.prisma.scorecard
      .delete({
        where: { id },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Scorecard not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return { message: `Scorecard ${id} deleted successfully.` };
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
    type: ScorecardResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Scorecard not found.' })
  async viewScorecard(@Param('id') id: string): Promise<ScorecardResponseDto> {
    const data = await this.prisma.scorecard
      .findUniqueOrThrow({
        where: { id },
        include: {
          scorecardGroups: {
            include: {
              sections: {
                include: {
                  questions: true,
                },
              },
            },
          },
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Scorecard not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as ScorecardResponseDto;
  }

  @Get()
  @Roles(UserRole.Admin, UserRole.Copilot)
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
  async searchScorecards(
    @Query('challengeTrack') challengeTrack?: ChallengeTrack,
    @Query('challengeType') challengeType?: string,
    @Query('name') name?: string,
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
  ) {
    const skip = (page - 1) * perPage;
    const data = await this.prisma.scorecard.findMany({
      where: {
        ...(challengeTrack && { challengeTrack }),
        ...(challengeType && { challengeType }),
        ...(name && { name: { contains: name, mode: 'insensitive' } }),
      },
      include: {
        scorecardGroups: {
          include: {
            sections: {
              include: {
                questions: true,
              },
            },
          },
        },
      },
      skip,
      take: perPage,
    });
    return data as ScorecardResponseDto[];
  }
}
