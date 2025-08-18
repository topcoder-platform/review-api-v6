import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { AxiosError } from 'axios';
import { M2MService } from './m2m.service';
import { Injectable, Logger } from '@nestjs/common';
import { CommonConfig } from 'src/shared/config/common.config';

export class ChallengeData {
  id: string;
  name: string;
  legacy?: {
    track?: string | undefined;
    subTrack?: string | undefined;
  };
  numOfSubmissions?: number | undefined;
  track: string;
  legacyId: number;
  tags?: string[] | undefined;
  workflows?: WorkflowData[] | undefined;
}

export class WorkflowData {
  worflowId: string;
  ref: string;
  params: Record<string, any>;
}

@Injectable()
export class ChallengeApiService {
  private readonly logger: Logger = new Logger(ChallengeApiService.name);

  constructor(
    private readonly m2mService: M2MService,
    private readonly httpService: HttpService,
  ) {}

  async getChallenges(challengeIds: string[]): Promise<ChallengeData[]> {
    // Get all challenge details at once.
    const results = await Promise.all(
      challengeIds.map((id) => this.getChallengeDetail(id)),
    );
    return results;
  }

  async getChallengeDetail(challengeId: string): Promise<ChallengeData> {
    // Get M2m token
    const token = await this.m2mService.getM2MToken();
    // Send request to challenge api
    const url = CommonConfig.apis.challengeApiUrl + challengeId;

    try {
      const response = await firstValueFrom(
        this.httpService.get<ChallengeData>(url, {
          headers: {
            Authorization: 'Bearer ' + token,
          },
        }),
      );
      const challenge = plainToInstance(ChallengeData, response.data);
      await validateOrReject(challenge);
      return challenge;
    } catch (e) {
      if (e instanceof AxiosError) {
        this.logger.error(`Http Error: ${e.message}`, e.response?.data);
        throw new Error('Cannot get data from Challenge API.');
      }
      this.logger.error(`Data validation error: ${e}`);
      throw new Error('Malformed data returned from Challenge API');
    }
  }
}
