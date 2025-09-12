import {
  Controller,
  Post,
  Body,
  Req,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  ContactRequestDto,
  ContactRequestResponseDto,
} from 'src/dto/contactRequest.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';
import { LoggerService } from '../../shared/modules/global/logger.service';

@ApiTags('Contact Requests')
@ApiBearerAuth()
@Controller('/')
export class ContactRequestsController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceApiService: ResourceApiService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {
    this.logger = LoggerService.forRoot('ContactRequestsController');
  }

  @Post('/contact-requests')
  @Roles(UserRole.User)
  @Scopes(Scope.CreateContactRequest)
  @ApiOperation({
    summary: 'Create a new contact request',
    description: 'Roles: User, Reviewer | Scopes: create:contact-request',
  })
  @ApiBody({ description: 'Contact request body', type: ContactRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Contact request created successfully.',
    type: ContactRequestResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createContactRequest(
    @Req() req: Request,
    @Body() body: ContactRequestDto,
  ): Promise<ContactRequestResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    this.logger.log(
      `Creating contact request for challenge: ${body.challengeId}, resource: ${body.resourceId}`,
    );

    try {
      await this.resourceApiService.validateResourcesRoles(
        [UserRole.Reviewer, UserRole.User],
        authUser,
        body.challengeId,
        body.resourceId,
      );

      const data = await this.prisma.contactRequest.create({
        data: { ...body },
      });

      this.logger.log(`Contact request created with ID: ${data.id}`);
      return data as ContactRequestResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating contact request for challenge ${body.challengeId} and resource ${body.resourceId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }
}
