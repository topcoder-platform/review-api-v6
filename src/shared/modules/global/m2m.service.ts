import { Injectable } from '@nestjs/common';
import { auth } from 'tc-core-library-js';

/** Supplies verified Keycloak tokens for downstream API calls using the shared credential/scope cache. */
@Injectable()
export class M2MService {
  private readonly client = auth.m2m();

  /** Takes no parameters; returns a verified token from explicit Keycloak configuration or throws on issuance/validation failure. */
  getM2MToken(): Promise<string> {
    return this.client.getMachineToken();
  }
}
