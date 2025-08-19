import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cors from 'cors';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiModule } from './api/api.module';
import { LoggerService } from './shared/modules/global/logger.service';
import { Response } from 'express';

const API_PREFIX = '/v6/review'; // Global prefix for all routes in production

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Create logger instance for application bootstrap
  const logger = LoggerService.forRoot('Bootstrap');

  // Global prefix for all routes in production
  if (process.env.NODE_ENV === 'production') {
    app.setGlobalPrefix(API_PREFIX);
    logger.log(`Setting global prefix to ${API_PREFIX} in production mode`);
  }

  console.log(
    '===============process.env.NODE_EN============',
    process.env.NODE_ENV,
  );
  logger.log('=========================' + process.env.NODE_ENV);

  // CORS related settings
  const corsConfig: cors.CorsOptions = {
    allowedHeaders:
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, Access-Control-Allow-Origin, Access-Control-Allow-Headers,currentOrg,overrideOrg,x-atlassian-cloud-id,x-api-key,x-orgid',
    credentials: true,
    origin: process.env.CORS_ALLOWED_ORIGIN
      ? new RegExp(process.env.CORS_ALLOWED_ORIGIN)
      : [
          'http://localhost:3000',
          /\.localhost:3000$/,
          'https://topcoder.com',
          'https://topcoder-dev.com',
          /\.topcoder-dev\.com$/,
          /\.topcoder\.com$/,
        ],
    methods: 'GET, POST, OPTIONS, PUT, DELETE, PATCH',
  };
  app.use(cors(corsConfig));
  logger.log('CORS configuration applied');

  // Add request logging middleware
  app.use((req, res, next) => {
    const requestLogger = LoggerService.forRoot('HttpRequest');
    const startTime = Date.now();
    const { method, originalUrl, ip, headers } = req;

    // Log request
    requestLogger.log({
      type: 'request',
      method,
      url: originalUrl,
      ip,
      userAgent: headers['user-agent'],
    });

    // Intercept response to log it
    const originalSend = res.send;
    res.send = function (body: any): Response {
      const responseTime = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Log response
      requestLogger.log({
        type: 'response',
        statusCode,
        method,
        url: originalUrl,
        responseTime: `${responseTime}ms`,
      });

      // If there's a 500+ error, log it as an error
      if (statusCode >= 500) {
        let responseBody;
        try {
          responseBody = typeof body === 'string' ? JSON.parse(body) : body;
        } catch {
          responseBody = body;
        }

        requestLogger.error({
          message: 'Server error response',
          statusCode,
          url: originalUrl,
          body: responseBody,
        });
      }

      return originalSend.call(this, body) as Response;
    };

    next();
  });

  // Add body parsers
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });
  // Add the global validation pipe to auto-map and validate DTOs
  // Note that the whitelist option sanitizes input DTOs so only properties defined on the class are set
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));
  logger.log('Body parsers and validation pipe configured');

  // Setup swagger
  // TODO: finish this and make it so this block only runs in non-prod
  const config = new DocumentBuilder()
    .setTitle('Topcoder Review API')
    .setDescription(
      `
    Topcoder Review API Documentation

    Authentication

    The API supports two authentication methods:

    User Token (JWT)
    - Regular user authentication using role-based access control
    - Tokens should include 'roles' claim with the appropriate role(s)
    - Available roles: Admin, Copilot, Reviewer, Submitter

    Machine-to-Machine (M2M) Token
    - For service-to-service authentication
    - Uses scope-based access control
    - Available scopes: create:appeal, read:appeal, update:appeal, delete:appeal, create:appeal-response, update:appeal-response, all:appeal, create:contact-request, all:contact-request, read:project-result, all:project-result, create:review, read:review, update:review, delete:review, create:review-item, update:review-item, delete:review-item, all:review, create:scorecard, read:scorecard, update:scorecard, delete:scorecard, all:scorecard create:review_type read:review_type update:review_type delete:review_type all:review_type create:review_summation read:review_summation update:review_summation delete:review_summation all:review_summation create:submission read:submission update:submission delete:submission all:submission

    To get an M2M token (example for development environment):

    curl --request POST \\
      --url https://topcoder-dev.auth0.com/oauth/token \\
      --header 'content-type: application/json' \\
      --data '{"client_id":"your-client-id","client_secret":"your-client-secret","audience":"https://m2m.topcoder-dev.com/","grant_type":"client_credentials"}'

    `,
    )
    .setVersion('1.0')
    .addTag('TC Review')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      name: 'JWT',
      description: 'Enter JWT access token',
      in: 'header',
    })
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    include: [ApiModule],
  });
  SwaggerModule.setup(`${API_PREFIX}/api-docs`, app, document);
  logger.log('Swagger documentation configured');

  // Add an event handler to log uncaught promise rejections and prevent the server from crashing
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', reason as string);
  });

  // Add an event handler to log uncaught errors and prevent the server from crashing
  process.on('uncaughtException', (error: Error) => {
    logger.error(`Uncaught Exception: ${error.message}`, error.stack);
  });

  // Listen on port
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Server started on port ${port}`);
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
