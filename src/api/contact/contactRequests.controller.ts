import { Controller, Post, Body, Req } from '@nestjs/common';
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
  mapContactRequestToDto,
} from 'src/dto/contactRequest.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';

@ApiTags('Contact Requests')
@ApiBearerAuth()
@Controller('/')
export class ContactRequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceApiService: ResourceApiService,
  ) {}

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
    await this.resourceApiService.validateResourcesRoles(
      [UserRole.Reviewer, UserRole.User],
      authUser,
      body.challengeId,
      body.resourceId,
    );

    const data = await this.prisma.contactRequest.create({
      data: mapContactRequestToDto(body),
    });
    return data as ContactRequestResponseDto;
  }
}
