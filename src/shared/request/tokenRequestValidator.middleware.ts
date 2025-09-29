import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '../modules/global/jwt.service';
import { LoggerService } from '../modules/global/logger.service';

@Injectable()
export class TokenValidatorMiddleware implements NestMiddleware {
  private readonly logger: LoggerService;

  constructor(private jwtService: JwtService) {
    this.logger = LoggerService.forRoot('Auth/TokenValidatorMiddleware');
  }

  async use(request: any, res: Response, next: (error?: any) => void) {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const [type, idToken] = request.headers.authorization.split(' ') ?? [];

    if (type !== 'Bearer') {
      return next();
    }
    
    if (!idToken) {
      throw new UnauthorizedException('Invalid or missing JWT!');
    }

    let decoded: any;
    try {
      decoded = await this.jwtService.validateToken(idToken);
    } catch (error) {
      this.logger.error('Error verifying JWT', error);
      throw new UnauthorizedException('Invalid or expired JWT!');
    }

    // Add user to request for later use in controllers
    request['user'] = decoded;
    request.idTokenVerified = true;

    return next();
  }
}
