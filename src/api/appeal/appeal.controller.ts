import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles, UserRole } from 'src/shared/guards/tokenRoles.guard';
import {
  AppealRequestDto,
  AppealResponseDto,
  AppealResponseRequestDto,
  AppealResponseResponseDto,
  mapAppealRequestToDto,
  mapAppealResponseRequestToDto,
} from 'src/dto/appeal.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';

@ApiTags('Appeal')
@ApiBearerAuth()
@Controller('/api/appeals')
export class AppealController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @Roles(UserRole.Submitter)
  @ApiOperation({
    summary: 'Create an appeal for a specific review item comment',
    description: 'Roles: Submitter',
  })
  @ApiBody({ description: 'Appeal request body', type: AppealRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Appeal created successfully.',
    type: AppealResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createAppeal(
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    const data = await this.prisma.appeal.create({
      data: mapAppealRequestToDto(body),
    });
    return data as AppealResponseDto;
  }

  @Patch('/:appealId')
  @Roles(UserRole.Submitter)
  @ApiOperation({
    summary: 'Update an appeal',
    description: 'Roles: Submitter',
  })
  @ApiParam({ name: 'appealId', description: 'The ID of the appeal to update' })
  @ApiBody({ description: 'Appeal request body', type: AppealRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Appeal updated successfully.',
    type: AppealResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal not found.' })
  async updateAppeal(
    @Param('appealId') appealId: string,
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    const data = await this.prisma.appeal
      .update({
        where: { id: appealId },
        data: mapAppealRequestToDto(body),
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Appeal not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as AppealResponseDto;
  }

  @Delete('/:appealId')
  @Roles(UserRole.Submitter)
  @ApiOperation({
    summary: 'Delete an appeal',
    description: 'Roles: Submitter',
  })
  @ApiParam({ name: 'appealId', description: 'The ID of the appeal to delete' })
  @ApiResponse({ status: 200, description: 'Appeal deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal not found.' })
  async deleteAppeal(@Param('appealId') appealId: string) {
    await this.prisma.appeal
      .delete({
        where: { id: appealId },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Appeal not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return { message: `Appeal ${appealId} deleted successfully.` };
  }

  @Post('/:appealId/response')
  @Roles(UserRole.Reviewer)
  @ApiOperation({
    summary: 'Create a response for an appeal',
    description: 'Roles: Reviewer',
  })
  @ApiParam({
    name: 'appealId',
    description: 'The ID of the appeal to respond to',
  })
  @ApiBody({
    description: 'Appeal response request body',
    type: AppealResponseRequestDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Appeal response created successfully.',
    type: AppealResponseResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal response not found.' })
  async createAppealResponse(
    @Param('appealId') appealId: string,
    @Body() body: AppealResponseRequestDto,
  ): Promise<AppealResponseResponseDto> {
    const data = await this.prisma.appeal
      .update({
        where: { id: appealId },
        data: {
          appealResponse: {
            create: mapAppealResponseRequestToDto(body),
          },
        },
        include: {
          appealResponse: true,
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({
            message: `Appeal response not found.`,
          });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data.appealResponse as AppealResponseResponseDto;
  }

  @Patch('/response/:appealResponseId')
  @Roles(UserRole.Reviewer)
  @ApiOperation({
    summary: 'Update a response for an appeal',
    description: 'Roles: Reviewer',
  })
  @ApiParam({
    name: 'appealResponseId',
    description: 'The ID of the appeal response to update the response for',
  })
  @ApiBody({
    description: 'Appeal response request body',
    type: AppealResponseRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Appeal response updated successfully.',
    type: AppealResponseResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal response not found.' })
  async updateAppealResponse(
    @Param('appealResponseId') appealResponseId: string,
    @Body() body: AppealResponseRequestDto,
  ): Promise<AppealResponseRequestDto> {
    const data = await this.prisma.appealResponse
      .update({
        where: { id: appealResponseId },
        data: mapAppealResponseRequestToDto(body),
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({
            message: `Appeal response not found.`,
          });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as AppealResponseRequestDto;
  }

  @Get('/')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @ApiOperation({
    summary: 'Get appeals',
    description: 'Filter appeals by submission ID and challenge ID',
  })
  @ApiQuery({
    name: 'resourceId',
    description: 'The ID of the resource to filter by',
    required: false,
  })
  @ApiQuery({
    name: 'challengeId',
    description: 'The ID of the challenge to filter by',
    required: false,
  })
  @ApiQuery({
    name: 'reviewId',
    description: 'The ID of the review to filter by',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'List of matching appeals',
    type: [AppealResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getAppeals(
    @Query('resourceId') resourceId?: string,
    @Query('challengeId') challengeId?: string,
    @Query('reviewId') reviewId?: string,
  ): Promise<AppealResponseDto[]> {
    const data = await this.prisma.appealResponse.findMany({
      where: {
        ...(resourceId && { resourceId }),
        ...(challengeId && { challengeId }),
        ...(reviewId && { appealId: reviewId }),
      },
    });
    return data.map((appeal) => ({
      ...appeal,
      reviewItemCommentId: '',
    })) as AppealResponseDto[];
  }
}
