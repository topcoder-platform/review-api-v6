import { OnModuleInit } from '@nestjs/common';
import { CommonConfig } from 'src/shared/config/common.config';
import {
  GiteaMembershipMember,
  GiteaTeamMembershipService,
} from '../../global/gitea-team-membership.service';
import { LoggerService } from '../../global/logger.service';
import { ResourcePrismaService } from '../../global/resource-prisma.service';
import { BaseEventHandler } from '../base-event.handler';
import { KafkaHandlerRegistry } from '../kafka-handler.registry';

/**
 * Resource payload emitted by resource-api on `challenge.action.resource.*`.
 */
interface ChallengeResourceEventPayload {
  challengeId?: unknown;
  memberId?: unknown;
  memberHandle?: unknown;
  roleId?: unknown;
}

interface ChallengeResourceEventEnvelope {
  payload?: ChallengeResourceEventPayload;
}

/**
 * Converts an untrusted event value to a trimmed nonempty string.
 *
 * @param value Event value to normalize.
 * @returns A trimmed string, or undefined when the value is not usable.
 * @throws This function never throws.
 */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Shared plumbing for the challenge registration and unregistration handlers.
 *
 * Both topics carry the same resource payload and both only care about the
 * roles that take part in the challenge's Gitea repositories — submitters and
 * reviewers — so validation and role filtering live here while the subclass
 * supplies the topic and the Gitea reconciliation direction.
 */
export abstract class ChallengeResourceMembershipHandler
  extends BaseEventHandler
  implements OnModuleInit
{
  /**
   * Creates a resource membership handler.
   *
   * @param handlerRegistry Registry used to subscribe this handler's topic.
   * @param membershipService Gitea team reconciliation service.
   * @param loggerName Logger context name for the concrete handler.
   * @throws This constructor does not intentionally throw.
   */
  /** Memoized `roleId -> lowercase role name` lookups; resource roles are static. */
  private readonly roleNameCache = new Map<string, string | undefined>();

  protected constructor(
    private readonly handlerRegistry: KafkaHandlerRegistry,
    protected readonly membershipService: GiteaTeamMembershipService,
    private readonly resourcePrisma: ResourcePrismaService,
    loggerName: string,
  ) {
    super(LoggerService.forRoot(loggerName));
  }

  /**
   * Reconciles Gitea team membership for a validated submitter resource.
   *
   * @param challengeId Challenge the resource belongs to.
   * @param member Registrant handle and Topcoder user id.
   * @returns Nothing.
   * @throws Implementations are expected to swallow Gitea failures.
   */
  protected abstract syncMembership(
    challengeId: string,
    member: GiteaMembershipMember,
  ): Promise<void>;

  /**
   * Registers this instance for its topic.
   *
   * @returns Nothing.
   * @throws Propagates unexpected registry failures.
   */
  onModuleInit(): void {
    this.handlerRegistry.registerHandler(this.getTopic(), this);
    this.logger.log(`Registered handler for topic: ${this.getTopic()}`);
  }

  /**
   * Handles one resource event, filtering out roles that are not synced.
   *
   * Gitea configuration problems are logged rather than rethrown so a single
   * challenge cannot stall the consumer or exhaust its retry budget.
   *
   * @param message Kafka message envelope.
   * @returns Nothing.
   * @throws This method does not throw.
   */
  async handle(message: unknown): Promise<void> {
    try {
      this.logMessage(message);

      if (!this.validateMessage(message)) {
        this.logger.warn('Invalid message received');
        return;
      }

      const payload = (message as ChallengeResourceEventEnvelope)?.payload;
      if (!payload) {
        this.logger.warn(
          `Message on topic ${this.getTopic()} has no payload. Skipping Gitea team sync.`,
        );
        return;
      }

      const roleId = toNonEmptyString(payload.roleId);
      if (!roleId || !(await this.isSyncedRole(roleId))) {
        this.logger.log(
          `Resource role ${roleId ?? 'unknown'} is not synced with Gitea teams. Skipping Gitea team sync.`,
        );
        return;
      }

      const challengeId = toNonEmptyString(payload.challengeId);
      const memberId = toNonEmptyString(payload.memberId);
      const memberHandle = toNonEmptyString(payload.memberHandle);

      if (!challengeId || !memberId || !memberHandle) {
        this.logger.warn(
          `Message on topic ${this.getTopic()} is missing challengeId, memberId or memberHandle. Skipping Gitea team sync.`,
        );
        return;
      }

      await this.syncMembership(challengeId, { memberHandle, memberId });
    } catch (error) {
      this.logger.error(
        `Error processing ${this.getTopic()} event for Gitea team sync`,
        error,
      );
    }
  }

  /**
   * Decides whether a resource role takes part in the Gitea team sync.
   *
   * Submitters are recognized by the configured role id so the common case
   * needs no lookup. Every other role is matched by name, because reviewers are
   * spread over several roles (reviewer, iterative reviewer, specification
   * reviewer, ...) whose ids differ per environment.
   *
   * @param roleId Resource role id carried by the event.
   * @returns True when members holding the role should be synced.
   * @throws This method does not throw; lookup failures resolve to false.
   */
  private async isSyncedRole(roleId: string): Promise<boolean> {
    if (roleId === CommonConfig.roles.submitterRoleId) {
      return true;
    }

    const roleName = await this.resolveRoleName(roleId);
    if (!roleName) {
      return false;
    }

    return CommonConfig.gitea.syncedRoleNameFragments.some((fragment) =>
      roleName.includes(fragment),
    );
  }

  /**
   * Resolves and memoizes the lowercase name of a resource role.
   *
   * @param roleId Resource role id carried by the event.
   * @returns The lowercase role name, or undefined when it cannot be resolved.
   * @throws This method does not throw; lookup failures are logged.
   */
  private async resolveRoleName(roleId: string): Promise<string | undefined> {
    if (this.roleNameCache.has(roleId)) {
      return this.roleNameCache.get(roleId);
    }

    let roleName: string | undefined;
    try {
      const role = await this.resourcePrisma.resourceRole.findUnique({
        where: { id: roleId },
        select: { nameLower: true, name: true },
      });
      roleName = (role?.nameLower ?? role?.name)?.toLowerCase();
      if (!roleName) {
        this.logger.warn(
          `Resource role ${roleId} was not found in the resource database. Skipping Gitea team sync.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Unable to resolve resource role ${roleId} for Gitea team sync`,
        error,
      );
      return undefined;
    }

    this.roleNameCache.set(roleId, roleName);
    return roleName;
  }
}
