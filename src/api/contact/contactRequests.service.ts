import {
  Injectable,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import {
  ContactRequestDto,
  ContactRequestResponseDto,
} from 'src/dto/contactRequest.dto';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import {
  EventBusSendEmailPayload,
  EventBusService,
} from 'src/shared/modules/global/eventBus.service';
import { MemberService } from 'src/shared/modules/global/member.service';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { CommonConfig } from 'src/shared/config/common.config';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';

@Injectable()
export class ContactRequestsService {
  private readonly logger = LoggerService.forRoot('ContactRequestsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceApiService: ResourceApiService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly eventBusService: EventBusService,
    private readonly memberService: MemberService,
    private readonly challengeService: ChallengeApiService,
    private readonly resourcePrisma: ResourcePrismaService,
  ) {}

  /**
   * Create a contact request and notify challenge managers/co-pilots via Event Bus email
   */
  async createContactRequest(
    authUser: JwtUser,
    body: ContactRequestDto,
  ): Promise<ContactRequestResponseDto> {
    this.logger.log(
      `Creating contact request for challenge: ${body.challengeId}`,
    );

    try {
      // Validate requester has access
      const memberId = authUser?.userId ? String(authUser.userId) : '';
      const requiresResourceCheck = !authUser?.isMachine && !isAdmin(authUser);

      if (requiresResourceCheck && !memberId) {
        throw new ForbiddenException({
          message:
            'You must be registered on this challenge to contact its managers.',
          code: 'CONTACT_REQUEST_FORBIDDEN',
        });
      }

      const challengeResources = await this.resourcePrisma.resource.findMany({
        where: {
          challengeId: body.challengeId,
        },
        orderBy: { createdAt: 'asc' },
      });

      const requesterResource = challengeResources.find((resource) => {
        return String(resource.memberId) === memberId;
      });
      this.logger.debug(
        `Found resource for requester: ${requesterResource?.id}`,
      );
      if (requiresResourceCheck && !requesterResource) {
        throw new ForbiddenException({
          message:
            'You must be registered on this challenge to contact its managers.',
          code: 'CONTACT_REQUEST_FORBIDDEN',
        });
      }

      if (!requesterResource) {
        throw new ForbiddenException({
          message: 'No associated resource was found for this request.',
          code: 'CONTACT_REQUEST_FORBIDDEN',
        });
      }

      // Persist contact request
      const data = await this.prisma.contactRequest.create({
        data: {
          ...body,
          resourceId: requesterResource.id,
        },
      });

      // Fire email notification to managers/copilots for the challenge
      await this.notifyChallengeManagers(
        authUser,
        body.challengeId,
        body.message,
      );

      this.logger.log(`Contact request created with ID: ${data.id}`);
      return data as ContactRequestResponseDto;
    } catch (error) {
      // Re-throw ForbiddenException as-is
      if (error instanceof ForbiddenException) throw error;

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating contact request for challenge ${body.challengeId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Notify copilot/manager/client manager/payment manager roles on a challenge
   */
  private async notifyChallengeManagers(
    authUser: JwtUser,
    challengeId: string,
    message: string,
  ): Promise<void> {
    // Load challenge info for name
    const challenge =
      await this.challengeService.getChallengeDetail(challengeId);

    // Fetch resources and role map
    const [resources, roleMap] = await Promise.all([
      this.resourceApiService.getResources({ challengeId }),
      this.resourceApiService.getResourceRoles(),
    ]);

    // Allowed role names
    const allowed = new Set<string>([
      'copilot',
      'manager',
      'client manager',
      'payment manager',
      'payments manager',
    ]);

    // Collect member IDs for targeted roles
    const memberIds = Array.from(
      new Set(
        resources
          .map((r) => ({
            memberId: r.memberId,
            roleName: (roleMap?.[r.roleId]?.name || '').toLowerCase(),
          }))
          .filter((r) => allowed.has(r.roleName))
          .map((r) => r.memberId),
      ),
    );

    if (memberIds.length === 0) {
      this.logger.warn(
        `No copilot/manager recipients found for challenge ${challengeId}`,
      );
      return;
    }

    // Get emails for recipients and requester
    const requesterId = authUser?.userId ? String(authUser.userId) : undefined;
    const lookupIds = requesterId
      ? Array.from(new Set([...memberIds, requesterId]))
      : memberIds;

    const memberInfos = await this.memberService.getUserEmails(lookupIds);
    const memberInfoById = new Map(
      memberInfos.map((info) => [String(info.userId), info]),
    );

    const recipients = Array.from(
      new Set(
        memberIds
          .map((id) => memberInfoById.get(id)?.email)
          .filter((email): email is string => Boolean(email)),
      ),
    );

    if (recipients.length === 0) {
      this.logger.warn(
        `No recipient emails found for challenge ${challengeId} targeted roles`,
      );
      return;
    }

    const requesterEmail = requesterId
      ? memberInfoById.get(requesterId)?.email
      : undefined;

    if (!requesterEmail && requesterId) {
      this.logger.warn(
        `No email found for requester ${requesterId} when notifying challenge ${challengeId}`,
      );
    }

    const payload: EventBusSendEmailPayload = new EventBusSendEmailPayload();
    payload.sendgrid_template_id =
      CommonConfig.sendgridConfig.contactManagersEmailTemplate;
    payload.recipients = recipients;
    payload.data = {
      handle: authUser.handle ?? '',
      challengeName: challenge.name,
      message: message ?? '',
    };
    if (requesterEmail) {
      payload.from = requesterEmail;
      payload.replyTo = requesterEmail;
    }

    await this.eventBusService.sendEmail(payload);
  }
}
