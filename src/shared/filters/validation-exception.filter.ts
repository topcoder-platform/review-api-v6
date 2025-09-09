import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { LoggerService } from '../modules/global/logger.service';

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  private readonly logger: LoggerService;

  constructor() {
    this.logger = LoggerService.forRoot('ValidationExceptionFilter');
  }

  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse() as any;

    // Check if this is a class-validator validation error
    if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      Array.isArray(exceptionResponse.message)
    ) {
      // Format validation errors into a more user-friendly format
      const validationErrors = this.formatValidationErrors(
        exceptionResponse.message,
      );

      const errorResponse = {
        message:
          validationErrors.length === 1
            ? validationErrors[0]
            : 'Request validation failed. Please check the following errors:',
        code: 'VALIDATION_ERROR',
        errors: validationErrors.length > 1 ? validationErrors : undefined,
        timestamp: new Date().toISOString(),
        path: request.url,
      };

      this.logger.warn(
        `Validation error occurred on ${request.method} ${request.url}: ${validationErrors.join(', ')}`,
      );

      response.status(status).json(errorResponse);
      return;
    }

    // Check if this is already a custom error format (from our controllers)
    if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      exceptionResponse.code
    ) {
      // This is already in our custom format, pass it through
      response.status(status).json({
        ...exceptionResponse,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

    // Default handling for other BadRequestExceptions
    response.status(status).json({
      message: exceptionResponse.message || 'Bad Request',
      code: 'BAD_REQUEST',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private formatValidationErrors(validationErrors: string[]): string[] {
    return validationErrors.map((error) => {
      // Transform common validation error messages to be more user-friendly
      if (error.includes('must be a string')) {
        const fieldMatch = error.match(/^(\w+) must be a string$/);
        return fieldMatch
          ? `Field '${fieldMatch[1]}' must be a text value.`
          : error;
      }

      if (error.includes('must be a number')) {
        const fieldMatch = error.match(/^(\w+) must be a number$/);
        return fieldMatch
          ? `Field '${fieldMatch[1]}' must be a numeric value.`
          : error;
      }

      if (error.includes('must be a boolean')) {
        const fieldMatch = error.match(/^(\w+) must be a boolean$/);
        return fieldMatch
          ? `Field '${fieldMatch[1]}' must be true or false.`
          : error;
      }

      if (error.includes('should not be empty')) {
        const fieldMatch = error.match(/^(\w+) should not be empty$/);
        return fieldMatch
          ? `Field '${fieldMatch[1]}' is required and cannot be empty.`
          : error;
      }

      if (error.includes('must be a Date instance')) {
        const fieldMatch = error.match(/^(\w+) must be a Date instance$/);
        return fieldMatch
          ? `Field '${fieldMatch[1]}' must be a valid date.`
          : error;
      }

      if (error.includes('must be a valid ISO 8601 date string')) {
        const fieldMatch = error.match(
          /^(\w+) must be a valid ISO 8601 date string$/,
        );
        return fieldMatch
          ? `Field '${fieldMatch[1]}' must be a valid date in ISO format (e.g., '2023-12-01T10:00:00Z').`
          : error;
      }

      if (error.includes('must be an object')) {
        const fieldMatch = error.match(/^(\w+) must be an object$/);
        return fieldMatch
          ? `Field '${fieldMatch[1]}' must be a valid object.`
          : error;
      }

      // Return the original error if no specific transformation applies
      return error;
    });
  }
}
