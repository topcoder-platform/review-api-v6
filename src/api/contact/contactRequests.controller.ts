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
  mapContactRequestToDto,
} from 'src/dto/contactRequest.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';

@ApiTags('Contact Requests')
@ApiBearerAuth()
@Controller('/api')
export class ContactRequestsController {
  constructor(private readonly prisma: PrismaService) {}

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
  async createContactRequest(
    @Body() body: ContactRequestDto,
  ): Promise<ContactRequestResponseDto> {
    const data = await this.prisma.contactRequest.create({
      data: mapContactRequestToDto(body),
    });
    return data as ContactRequestResponseDto;
  }
}
