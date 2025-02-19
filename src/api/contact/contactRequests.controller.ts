import { Controller, Post, Body } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles, UserRole } from 'src/shared/guards/tokenRoles.guard';
import {
  ContactRequestDto,
  ContactRequestResponseDto,
  mockContactRequestResponse,
} from 'src/dto/contactRequest.dto';

@ApiTags('Contact Requests')
@ApiBearerAuth()
@Controller('/api')
export class ContactRequestsController {
  @Post('/contact-requests')
  @Roles(UserRole.Submitter, UserRole.Reviewer)
  @ApiOperation({ summary: 'Create a new contact request' })
  @ApiBody({ description: 'Contact request body', type: ContactRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Contact request created successfully.',
    type: ContactRequestResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  createContactRequest(
    @Body() body: ContactRequestDto,
  ): ContactRequestResponseDto {
    return mockContactRequestResponse;
  }
}
