import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { CommonConfig } from 'src/shared/config/common.config';
import { ResourceRole } from 'src/shared/models/ResourceRole.model';
import { ResourceInfo } from 'src/shared/models/ResourceInfo.model';
import { JwtUser } from './jwt.service';
import { M2MService } from './m2m.service';

@Injectable()
export class ResourceApiService {
  private readonly logger: Logger = new Logger(ResourceApiService.name);

  constructor(
    private readonly m2mService: M2MService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Fetch list of resource roles
   *
   * @returns resolves to list of resource role
   */
  async getResourceRoles(): Promise<{
    [key: string]: ResourceRole;
  }> {
    try {
      // Send request to resource api
      const response = await firstValueFrom(
        this.httpService.get<ResourceRole[]>(
          `${CommonConfig.apis.resourceApiUrl}resource-roles`,
          {},
        ),
      );
      return response.data.reduce(
        (mappingResult, resourceRole: ResourceRole) => ({
          ...mappingResult,
          [resourceRole.id]: resourceRole,
        }),
        {},
      );
    } catch (e) {
      if (e instanceof AxiosError) {
        this.logger.error(`Http Error: ${e.message}`, e.response?.data);
        throw new Error('Cannot get data from Resource API.');
      }
      this.logger.error(`Data validation error: ${e}`);
      throw new Error('Malformed data returned from Resource API');
    }
  }

  /**
   * Fetch list of resource
   *
   * @returns resolves to list of resource info
   */
  async getResources(query: {
    challengeId?: string;
    memberId?: string;
  }): Promise<ResourceInfo[]> {
    try {
      // Send request to resource api
      const params = new URLSearchParams();
      if (query.challengeId) params.append('challengeId', query.challengeId);
      if (query.memberId) params.append('memberId', query.memberId);

      const url = `${CommonConfig.apis.resourceApiUrl}resources?${params.toString()}`;
      const token = await this.m2mService.getM2MToken();
      const response = await firstValueFrom(
        this.httpService.get<ResourceInfo[]>(url, {
          headers: {
            Authorization: 'Bearer ' + token,
          },
        }),
      );
      return response.data;
    } catch (e) {
      if (e instanceof AxiosError) {
        this.logger.error(`Http Error: ${e.message}`, e.response?.data);
        const error = new Error('Cannot get data from Resource API.');
        (error as any).statusCode = e.response?.status;
        (error as any).originalMessage = e.response?.data?.message;
        throw error;
      }
      this.logger.error(`Data validation error: ${e}`);
      throw new Error('Malformed data returned from Resource API');
    }
  }

  /**
   * Fetch list of role resources
   *
   * @returns resolves to list of resource info
   */
  async getMemberResourcesRoles(
    challengeId?: string,
    memberId?: string,
  ): Promise<ResourceInfo[]> {
    const resourceRoles = await this.getResourceRoles();
    return (
      await this.getResources({
        challengeId: challengeId,
        memberId: memberId,
      })
    )
      .filter((resource) => resource.memberId === memberId)
      .map((resource) => ({
        ...resource,
        roleName: resourceRoles?.[resource.roleId]?.name ?? '',
      }));
  }

  /**
   * Validate resource role
   *
   * @param requiredRoles list of require roles
   * @param authUser login user info
   * @param challengeId challenge id
   * @param resourceId resource id (optional)
   * @returns resolves to the matching resource info if role is valid
   */
  async validateResourcesRoles(
    requiredRoles: string[],
    authUser: JwtUser,
    challengeId: string,
    resourceId?: string,
  ): Promise<ResourceInfo> {
    const normalizedRoles = requiredRoles.map((item) => item.toLowerCase());
    const memberResources = await this.getMemberResourcesRoles(
      challengeId,
      authUser.userId,
    );

    const matches = memberResources
      .filter((resource) => !resourceId || resource.id === resourceId)
      .map((resource) => {
        const roleName = resource.roleName?.toLowerCase() ?? '';
        const matchIndex = normalizedRoles.findIndex(
          (role) => roleName.indexOf(role) >= 0,
        );
        return {
          matchIndex,
          resource,
        };
      })
      .filter(({ matchIndex }) => matchIndex !== -1)
      .sort((a, b) => a.matchIndex - b.matchIndex);

    if (!matches.length) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return matches[0].resource;
  }

  /**
   * Validate if a member is registered as a submitter for a challenge
   *
   * @param challengeId challenge id
   * @param memberId member id to validate
   * @returns resolves to true if member is a valid submitter
   */
  async validateSubmitterRegistration(
    challengeId: string,
    memberId: string,
  ): Promise<boolean> {
    try {
      const resources = await this.getResources({
        challengeId: challengeId,
        memberId: memberId,
      });

      // Check if member has any resources for this challenge
      if (!resources || resources.length === 0) {
        throw new Error(
          `Member ${memberId} is not registered for challenge ${challengeId}.`,
        );
      }

      // Check if member has the submitter role
      const submitterResource = resources.find(
        (resource) => resource.roleId === CommonConfig.roles.submitterRoleId,
      );

      if (!submitterResource) {
        throw new Error(
          `Member ${memberId} is not registered as a submitter for challenge ${challengeId}.`,
        );
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Error validating submitter registration for member ${memberId} on challenge ${challengeId}:`,
        error,
      );
      throw error;
    }
  }
}
