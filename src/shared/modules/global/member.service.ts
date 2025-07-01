import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { M2MService } from './m2m.service';
import { HttpService } from '@nestjs/axios';
import { CommonConfig } from 'src/shared/config/common.config';
import { firstValueFrom } from 'rxjs';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { AxiosError } from 'axios';

export class MemberInfo {
  userId: number;
  email: string;
}

@Injectable()
export class MemberService {
  private readonly logger: Logger = new Logger(MemberService.name);

  constructor(
    private readonly m2mService: M2MService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Get user emails from Member API
   * @param userIds user id list
   * @returns user info list
   */
  async getUserEmails(userIds: string[]) {
    const token = await this.m2mService.getM2MToken();
    // construct URL of member API. Eg, https://api.topcoder-dev.com/v5/members?fields=email,userId&userIds=[123456]
    const url =
      CommonConfig.apis.memberApiUrl +
      `?fields=email,userId&userIds=[${userIds.join(',')}]`;
    // send request
    try {
      const response = await firstValueFrom(
        this.httpService.get<MemberInfo[]>(url, {
          headers: {
            Authorization: 'Bearer ' + token,
          },
        }),
      );
      const infoList = plainToInstance(MemberInfo, response.data);
      await Promise.all(infoList.map((e) => validateOrReject(e)));
      return infoList;
    } catch (e) {
      if (e instanceof AxiosError) {
        this.logger.error(
          `Can't get member info: ${e.message}`,
          e.response?.data,
        );
        throw new InternalServerErrorException(
          'Cannot get data from Member API.',
        );
      }
      this.logger.error(`Member Data validation error: ${e}`);
      throw new InternalServerErrorException(
        'Malformed data returned from Member API',
      );
    }
  }
}
