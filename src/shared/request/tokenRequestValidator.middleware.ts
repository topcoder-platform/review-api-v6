import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { JwtService, JwtUser } from '../modules/global/jwt.service';
import { LoggerService } from '../modules/global/logger.service';

@Injectable()
export class TokenValidatorMiddleware implements NestMiddleware {
  private readonly logger: LoggerService;

  constructor(private jwtService: JwtService) {
    this.logger = LoggerService.forRoot('Auth/TokenValidatorMiddleware');
  }

  async use(
    request: Request & { user?: JwtUser; idTokenVerified?: boolean },
    res: Response,
    next: (error?: any) => void,
  ) {
    const meta = this.buildRequestMeta(request);
    const authHeader = request.headers.authorization;
    const normalizedAuthHeader = Array.isArray(authHeader)
      ? authHeader[0]
      : authHeader;

    this.logger.log({
      message: 'Token validator middleware invoked',
      ...meta,
      hasAuthHeader: Boolean(normalizedAuthHeader),
      authHeaderArrayLength: Array.isArray(authHeader)
        ? authHeader.length
        : undefined,
    });

    if (!normalizedAuthHeader) {
      this.logger.log({
        message: 'No authorization header found, skipping token validation',
        ...meta,
      });
      return next();
    }

    const [type, idToken] = normalizedAuthHeader.split(' ') ?? [];

    if (type !== 'Bearer') {
      this.logger.log({
        message: 'Authorization header present but not a Bearer token',
        ...meta,
      });
      return next();
    }

    if (!idToken) {
      throw new UnauthorizedException('Invalid or missing JWT!');
    }

    let decoded: any;
    const tokenHash = this.anonymizeToken(idToken);

    this.logger.log({
      message: 'Validating bearer token',
      ...meta,
      tokenHash,
    });

    try {
      decoded = await this.jwtService.validateToken(idToken);
    } catch (error) {
      this.logger.error(
        {
          message: 'Error verifying JWT',
          ...meta,
          tokenHash,
          error: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
      );
      throw new UnauthorizedException('Invalid or expired JWT!');
    }

    // Add user to request for later use in controllers
    request['user'] = decoded;
    request.idTokenVerified = true;

    this.logger.log({
      message: 'Token successfully validated and attached to request',
      ...meta,
      tokenHash,
      userId: decoded?.userId,
      isMachine: Boolean(decoded?.isMachine),
      hasRoles: Array.isArray(decoded?.roles),
      hasScopes: Array.isArray(decoded?.scopes),
    });

    return next();
  }

  private buildRequestMeta(request: Request) {
    const headers = request.headers || {};
    const correlationIdCandidate =
      headers['x-request-id'] ||
      headers['x-correlation-id'] ||
      headers['x-trace-id'];

    return {
      method: request.method,
      url: request.originalUrl || request.url,
      correlationId: Array.isArray(correlationIdCandidate)
        ? correlationIdCandidate[0]
        : correlationIdCandidate,
    };
  }

  private anonymizeToken(token?: string): string | undefined {
    if (!token) {
      return undefined;
    }
    return createHash('sha256').update(token).digest('hex').slice(0, 16);
  }
}
