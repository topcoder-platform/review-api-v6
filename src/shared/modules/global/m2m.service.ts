import { Injectable } from '@nestjs/common';
import * as core from 'tc-core-library-js';
import { M2mConfig } from 'src/shared/config/m2m.config';

/**
 * Service to get M2M token with auth0 configs
 */
@Injectable()
export class M2MService {
  private readonly m2m;

  constructor() {
    const config = M2mConfig.auth0;
    this.m2m = core.auth.m2m({
      AUTH0_URL: config.url,
      AUTH0_AUDIENCE: config.audience,
      AUTH0_PROXY_SERVER_URL: config.proxyUrl,
    });
  }

  async getM2MToken() {
    const config = M2mConfig.auth0;
    return (await this.m2m.getMachineToken(
      config.clientId,
      config.clientSecret,
    )) as string;
  }
}
