import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import {
  AppealRequestDto,
  AppealResponseDto,
  AppealResponseRequestDto,
  AppealResponseResponseDto,
} from 'src/dto/appeal.dto';
import { PaginatedResponse, PaginationDto } from 'src/dto/pagination.dto';
import { Scope } from 'src/shared/enums/scopes.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { AppealService } from './appeal.service';

@ApiTags('Appeal')
@ApiBearerAuth()
@Controller('/appeals')
export class AppealController {
  constructor(private readonly appealService: AppealService) {}

  @Post()
  @Roles(UserRole.User, UserRole.Admin)
  @Scopes(Scope.CreateAppeal)
  @ApiOperation({
    summary: 'Create an appeal for a specific review item comment',
    description:
      'Roles: User (only for the review of their own submission) | Admin | Scopes: create:appeal',
  })
  @ApiBody({ description: 'Appeal request body', type: AppealRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Appeal created successfully.',
    type: AppealResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createAppeal(
    @Req() req: Request,
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    const authUser = req['user'] as JwtUser;
    return this.appealService.createAppeal(authUser, body);
  }

  @Patch('/:appealId')
  @Roles(UserRole.User, UserRole.Admin)
  @Scopes(Scope.UpdateAppeal)
  @ApiOperation({
    summary: 'Update an appeal',
    description:
      'Roles: User (only for the review of their own submission) | Admin | Scopes: update:appeal',
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
    @Req() req: Request,
    @Param('appealId') appealId: string,
    @Body() body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    const authUser = req['user'] as JwtUser;
    return this.appealService.updateAppeal(authUser, appealId, body);
  }

  @Delete('/:appealId')
  @Roles(UserRole.User, UserRole.Admin)
  @Scopes(Scope.DeleteAppeal)
  @ApiOperation({
    summary: 'Delete an appeal',
    description:
      'Roles: User (only for the review of their own submission) | Admin | Scopes: delete:appeal',
  })
  @ApiParam({ name: 'appealId', description: 'The ID of the appeal to delete' })
  @ApiResponse({ status: 200, description: 'Appeal deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Appeal not found.' })
  async deleteAppeal(@Req() req: Request, @Param('appealId') appealId: string) {
    const authUser = req['user'] as JwtUser;
    return this.appealService.deleteAppeal(authUser, appealId);
  }

  @Post('/:appealId/response')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer)
  @Scopes(Scope.CreateAppealResponse)
  @ApiOperation({
    summary: 'Create a response for an appeal',
    description: 'Roles: Reviewer | Admin | Scopes: create:appeal-response',
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
    @Req() req: Request,
    @Param('appealId') appealId: string,
    @Body() body: AppealResponseRequestDto,
  ): Promise<AppealResponseResponseDto> {
    const authUser = req['user'] as JwtUser;
    return this.appealService.createAppealResponse(authUser, appealId, body);
  }

  @Patch('/response/:appealResponseId')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer)
  @Scopes(Scope.UpdateAppealResponse)
  @ApiOperation({
    summary: 'Update a response for an appeal',
    description: 'Roles: Reviewer | Admin | Scopes: update:appeal-response',
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
    @Req() req: Request,
    @Param('appealResponseId') appealResponseId: string,
    @Body() body: AppealResponseRequestDto,
  ): Promise<AppealResponseRequestDto> {
    const authUser = req['user'] as JwtUser;
    return this.appealService.updateAppealResponse(
      authUser,
      appealResponseId,
      body,
    );
  }

  @Get('/')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer, UserRole.User)
  @Scopes(Scope.ReadAppeal)
  @ApiOperation({
    summary: 'Get appeals',
    description: 'Roles: Admin, Reviewer, User, Copilot | Scopes: read:appeal',
  })
  @ApiQuery({
    name: 'resourceId',
    description: 'The ID of the resource to filter by',
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
    @Query('reviewId') reviewId?: string,
    @Query() paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<AppealResponseDto>> {
    return this.appealService.getAppeals(resourceId, reviewId, paginationDto);
  }
}
