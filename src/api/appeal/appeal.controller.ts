import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
  mockAppealDto,
  mockAppealResponseDto,
} from 'src/dto/appeal.dto';

@ApiTags('Appeal')
@ApiBearerAuth()
@Controller('/api/appeals')
export class AppealController {
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
  createAppeal(@Body() body: AppealRequestDto): AppealResponseDto {
    return mockAppealDto;
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
  updateAppeal(
    @Param('appealId') appealId: string,
    @Body() body: AppealRequestDto,
  ): AppealResponseDto {
    return mockAppealDto;
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
  deleteAppeal(@Param('appealId') appealId: string) {
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
  createAppealResponse(
    @Param('appealId') appealId: string,
    @Body() body: AppealResponseRequestDto,
  ): AppealResponseResponseDto {
    return mockAppealResponseDto;
  }

  @Patch('/:appealId/response/:appealResponseId')
  @Roles(UserRole.Reviewer)
  @ApiOperation({
    summary: 'Update a response for an appeal',
    description: 'Roles: Reviewer',
  })
  @ApiParam({
    name: 'appealId',
    description: 'The ID of the appeal to update the response for',
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
  updateAppealResponse(
    @Param('appealId') appealId: string,
    @Param('appealResponseId') appealResponseId: string,
    @Body() body: AppealResponseRequestDto,
  ): AppealResponseRequestDto {
    return mockAppealResponseDto;
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
  getAppeals(
    @Query('resourceId') resourceId?: string,
    @Query('challengeId') challengeId?: string,
    @Query('reviewId') reviewId?: string,
  ): AppealResponseDto[] {
    return [mockAppealDto];
  }
}
