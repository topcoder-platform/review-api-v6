import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LoggerService } from './logger.service';

@Injectable()
export class PrismaErrorService {
  private readonly logger: LoggerService;

  constructor() {
    this.logger = LoggerService.forRoot('PrismaErrorService');
  }

  /**
   * Handle Prisma errors and return user-friendly error messages
   * @param error Prisma error object
   * @param context Optional context for the error (e.g., "fetching review")
   * @returns User-friendly error object with message and code
   */
  handleError(error: any, context?: string): { message: string; code: string } {
    // Log the original error for debugging
    this.logger.error(
      `Prisma error ${context ? `while ${context}` : ''}: ${error.message}`,
      error.stack,
    );

    // Handle known Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handleKnownRequestError(error);
    }

    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      return {
        message:
          'An unexpected database error occurred. Please try again later.',
        code: 'DATABASE_ERROR',
      };
    }

    if (error instanceof Prisma.PrismaClientRustPanicError) {
      return {
        message: 'A critical database error occurred. Please try again later.',
        code: 'CRITICAL_DATABASE_ERROR',
      };
    }

    if (error instanceof Prisma.PrismaClientInitializationError) {
      return {
        message:
          'The application failed to connect to the database. Please try again later.',
        code: 'DATABASE_CONNECTION_ERROR',
      };
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      return {
        message:
          'The request contains invalid data that could not be processed.',
        code: 'VALIDATION_ERROR',
      };
    }

    // Default error message for unhandled errors
    return {
      message: 'An unexpected error occurred. Please try again later.',
      code: 'UNKNOWN_ERROR',
    };
  }

  /**
   * Handle known Prisma request errors based on their error codes
   * @param error Prisma known request error
   * @returns User-friendly error object with message and code
   */
  private handleKnownRequestError(
    error: Prisma.PrismaClientKnownRequestError,
  ): { message: string; code: string } {
    // Extract target field information if available
    const targetField = error.meta?.target
      ? Array.isArray(error.meta.target)
        ? error.meta.target.join(', ')
        : String(error.meta.target) // eslint-disable-line @typescript-eslint/no-base-to-string
      : null;

    switch (error.code) {
      // Not found errors
      case 'P2001':
        return {
          message: 'The requested record does not exist.',
          code: 'RECORD_NOT_FOUND',
        };
      case 'P2025':
        return {
          message: 'The requested record could not be found.',
          code: 'RECORD_NOT_FOUND',
        };

      // Unique constraint violations
      case 'P2002':
        return {
          message: targetField
            ? `A record with the same ${targetField} already exists.`
            : 'A record with the same unique fields already exists.',
          code: 'UNIQUE_CONSTRAINT_FAILED',
        };

      // Foreign key constraint failures
      case 'P2003':
        return {
          message: targetField
            ? `The operation failed because the referenced ${targetField} does not exist.`
            : 'The operation failed because a referenced record does not exist.',
          code: 'FOREIGN_KEY_CONSTRAINT_FAILED',
        };

      // Required field constraint violations
      case 'P2004':
      case 'P2011':
        return {
          message: 'A required field is missing or has an invalid value.',
          code: 'REQUIRED_FIELD_MISSING',
        };

      // Data validation errors
      case 'P2006':
      case 'P2007':
      case 'P2008':
      case 'P2009':
      case 'P2010':
      case 'P2012':
        return {
          message: 'The provided data is invalid or in an incorrect format.',
          code: 'INVALID_DATA',
        };

      // Connection and timeout errors
      case 'P1000':
      case 'P1001':
      case 'P1002':
        return {
          message: 'Failed to connect to the database. Please try again later.',
          code: 'DATABASE_CONNECTION_ERROR',
        };

      case 'P1008':
        return {
          message:
            'The operation timed out. Please try again later or with a simpler query.',
          code: 'OPERATION_TIMEOUT',
        };

      case 'P2024':
      case 'P2034':
        return {
          message:
            'The request timed out due to high database load. Please try again later.',
          code: 'TIMEOUT',
        };

      case 'P2037':
        return {
          message:
            'The server is experiencing high load. Please try again later.',
          code: 'TOO_MANY_CONNECTIONS',
        };

      // Query size/complexity limits
      case 'P2026':
      case 'P2027':
      case 'P2028':
      case 'P2029':
        return {
          message: 'The request is too complex. Please simplify your request.',
          code: 'QUERY_COMPLEXITY',
        };

      default:
        return {
          message:
            'An unexpected database error occurred. Please try again later.',
          code: 'DATABASE_ERROR',
        };
    }
  }
}
