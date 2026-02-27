import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { ChallengeReviewContextService } from './challenge-review-context.service';
import {
  CreateChallengeReviewContextDto,
  UpdateChallengeReviewContextDto,
  ChallengeReviewContextResponseDto,
} from '../../dto/challengeReviewContext.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { User } from 'src/shared/decorators/user.decorator';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';

@ApiTags('Challenge Review Context')
@ApiBearerAuth()
@Controller('reviews/context')
export class ChallengeReviewContextController {
  constructor(
    private readonly challengeReviewContextService: ChallengeReviewContextService,
  ) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateChallengeReviewContext)
  @ApiOperation({
    summary: 'Create a challenge review context',
    description:
      'Roles: Admin, Copilot | Scopes: create:challenge-review-context. Only allowed for challenges in DRAFT status or REGISTRATION phase. At most one context per challenge.',
  })
  @ApiBody({
    description: 'Challenge review context to create',
    type: CreateChallengeReviewContextDto,
  })
  @ApiResponse({
    status: 201,
    description: 'The challenge review context has been successfully created.',
    type: ChallengeReviewContextResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g. context must be a non-empty object).',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden. Challenge is not in DRAFT status or REGISTRATION phase.',
  })
  @ApiResponse({ status: 404, description: 'Challenge not found.' })
  @ApiResponse({
    status: 409,
    description: 'Conflict. A context already exists for this challenge.',
  })
  async create(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateChallengeReviewContextDto,
    @User() authUser: JwtUser,
  ) {
    return this.challengeReviewContextService.create(dto, authUser);
  }

  @Get(':challengeId')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.ReadChallengeReviewContext)
  @ApiOperation({
    summary: 'Get challenge review context by challenge ID',
    description:
      'Roles: Admin, Copilot | Scopes: read:challenge-review-context',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The challenge ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'The challenge review context.',
    type: ChallengeReviewContextResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Challenge or context not found.' })
  async getByChallengeId(@Param('challengeId') challengeId: string) {
    return this.challengeReviewContextService.getByChallengeId(challengeId);
  }

  @Put(':challengeId')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.UpdateChallengeReviewContext)
  @ApiOperation({
    summary: 'Update a challenge review context',
    description:
      'Roles: Admin, Copilot | Scopes: update:challenge-review-context. Only allowed for challenges in DRAFT status or REGISTRATION phase.',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The challenge ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({
    description: 'Challenge review context data to update',
    type: UpdateChallengeReviewContextDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Challenge review context updated successfully.',
    type: ChallengeReviewContextResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g. context must be a non-empty object).',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden. Challenge is not in DRAFT status or REGISTRATION phase.',
  })
  @ApiResponse({ status: 404, description: 'Challenge or context not found.' })
  async update(
    @Param('challengeId') challengeId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: UpdateChallengeReviewContextDto,
    @User() authUser: JwtUser,
  ) {
    return this.challengeReviewContextService.update(
      challengeId,
      dto,
      authUser,
    );
  }
}
