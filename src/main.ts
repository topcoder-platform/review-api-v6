import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cors from 'cors';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiModule } from './api/api.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Global prefix for all routes in production is configured as `/v5/review`
  if (process.env.NODE_ENV === 'production') {
    app.setGlobalPrefix('/v5/review');
  }

  // CORS related settings
  const corsConfig: cors.CorsOptions = {
    allowedHeaders:
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, Access-Control-Allow-Origin, Access-Control-Allow-Headers,currentOrg,overrideOrg,x-atlassian-cloud-id,x-api-key,x-orgid',
    credentials: true,
    origin: process.env.CORS_ALLOWED_ORIGIN
      ? new RegExp(process.env.CORS_ALLOWED_ORIGIN)
      : ['http://localhost:3000', /\.localhost:3000$/],
    methods: 'GET, POST, OPTIONS, PUT, DELETE, PATCH',
  };
  app.use(cors(corsConfig));

  // Add body parsers
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });
  // Add the global validation pipe to auto-map and validate DTOs
  // Note that the whitelist option sanitizes input DTOs so only properties defined on the class are set
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));

  // Setup swagger
  // TODO: finish this and make it so this block only runs in non-prod
  const config = new DocumentBuilder()
    .setTitle('Topcoder Review API')
    .setDescription(`
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
    - Available scopes: create:appeal, read:appeal, update:appeal, delete:appeal, create:appeal-response, update:appeal-response, all:appeal, create:contact-request, all:contact-request, read:project-result, all:project-result, create:review, read:review, update:review, delete:review, create:review-item, update:review-item, delete:review-item, all:review, create:scorecard, read:scorecard, update:scorecard, delete:scorecard, all:scorecard
    
    To get an M2M token (example for development environment):

    curl --request POST \\
      --url https://topcoder-dev.auth0.com/oauth/token \\
      --header 'content-type: application/json' \\
      --data '{"client_id":"your-client-id","client_secret":"your-client-secret","audience":"https://m2m.topcoder-dev.com/","grant_type":"client_credentials"}'

    `)
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
  SwaggerModule.setup('/v5/review/api-docs', app, document);

  // Add an event handler to log uncaught promise rejections and prevent the server from crashing
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  // Add an event handler to log uncaught errors and prevent the server from crashing
  process.on('uncaughtException', (error: Error) => {
    console.error(
      `Unhandled Error at: ${error}\n` + `Exception origin: ${error.stack}`,
    );
  });

  // Listen on port
  await app.listen(process.env.PORT ?? 3000);
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
