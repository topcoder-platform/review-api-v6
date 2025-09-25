import { Controller, Post, Body, Req } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  ContactRequestDto,
  ContactRequestResponseDto,
} from 'src/dto/contactRequest.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { ContactRequestsService } from './contactRequests.service';

@ApiTags('Contact Requests')
@ApiBearerAuth()
@Controller('/')
export class ContactRequestsController {
  private readonly logger: LoggerService;

  constructor(private readonly contactRequestsService: ContactRequestsService) {
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
    return this.contactRequestsService.createContactRequest(authUser, body);
  }
}
