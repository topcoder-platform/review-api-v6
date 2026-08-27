import { Injectable } from '@nestjs/common';
import {
  GiteaMembershipMember,
  GiteaTeamMembershipService,
} from '../../global/gitea-team-membership.service';
import { ChallengeResourceMembershipHandler } from './challenge-resource-membership.base';
import { KafkaHandlerRegistry } from '../kafka-handler.registry';
import { ResourcePrismaService } from '../../global/resource-prisma.service';

/**
 * Adds challenge registrants to the Gitea teams configured on the challenge.
 *
 * This provider is registered in GlobalProvidersModule. Nest calls
 * onModuleInit to subscribe it through KafkaHandlerRegistry.
 */
@Injectable()
export class ChallengeResourceCreateHandler extends ChallengeResourceMembershipHandler {
  private readonly topic =
    process.env.RESOURCE_CREATE_TOPIC ?? 'challenge.action.resource.create';

  /**
   * Creates the registration handler.
   *
   * @param handlerRegistry Registry used to subscribe this handler's topic.
   * @param membershipService Gitea team reconciliation service.
   * @param resourcePrisma Resource database used to resolve resource role names.
   * @throws This constructor does not intentionally throw.
   */
  constructor(
    handlerRegistry: KafkaHandlerRegistry,
    membershipService: GiteaTeamMembershipService,
    resourcePrisma: ResourcePrismaService,
  ) {
    super(
      handlerRegistry,
      membershipService,
      resourcePrisma,
      'ChallengeResourceCreateHandler',
    );
  }

  /**
   * @returns The Kafka topic carrying challenge registrations.
   */
  getTopic(): string {
    return this.topic;
  }

  /**
   * Adds the registrant to every configured Gitea team.
   *
   * @param challengeId Challenge the member registered for.
   * @param member Registrant handle and Topcoder user id.
   * @returns Nothing.
   * @throws This method does not throw.
   */
  protected async syncMembership(
    challengeId: string,
    member: GiteaMembershipMember,
  ): Promise<void> {
    await this.membershipService.addMemberToChallengeTeams(challengeId, member);
  }
}
