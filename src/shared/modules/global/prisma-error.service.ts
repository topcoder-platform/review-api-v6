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
   * @param data Optional data object that was being processed when the error occurred
   * @returns User-friendly error object with message and code
   */
  handleError(
    error: any,
    context?: string,
    data?: any,
  ): { message: string; code: string; details?: any } {
    // Log the original error for debugging - include full error details
    this.logger.error(
      `Prisma error ${context ? `while ${context}` : ''}: ${error.message}
      Code: ${error.code}
      Meta: ${JSON.stringify(error.meta)}
      Stack: ${error.stack}`,
    );

    // Handle known Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handleKnownRequestError(error, context, data);
    }

    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      return {
        message: context
          ? `An unexpected database error occurred while ${context}. Please check your request and try again.`
          : 'An unexpected database error occurred. Please check your request and try again.',
        code: 'DATABASE_ERROR',
        details: { context, originalError: error.message },
      };
    }

    if (error instanceof Prisma.PrismaClientRustPanicError) {
      return {
        message:
          'A critical database error occurred. Please contact support if this persists.',
        code: 'CRITICAL_DATABASE_ERROR',
        details: { context },
      };
    }

    if (error instanceof Prisma.PrismaClientInitializationError) {
      return {
        message:
          'The application failed to connect to the database. Please try again later.',
        code: 'DATABASE_CONNECTION_ERROR',
        details: { context },
      };
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      // Extract validation details from the error message
      const validationDetails = this.extractValidationDetails(error.message);
      return {
        message:
          validationDetails.message ||
          'The request contains invalid data. Please check the field types and required fields.',
        code: 'VALIDATION_ERROR',
        details: {
          context,
          fields: validationDetails.fields,
          requiredFields: validationDetails.requiredFields,
          invalidFields: validationDetails.invalidFields,
        },
      };
    }

    // Default error message for unhandled errors
    return {
      message: context
        ? `An unexpected error occurred while ${context}. Please try again.`
        : 'An unexpected error occurred. Please try again.',
      code: 'UNKNOWN_ERROR',
      details: { context, errorType: error.constructor.name },
    };
  }

  /**
   * Handle known Prisma request errors based on their error codes
   * @param error Prisma known request error
   * @param context Optional context for the error
   * @param data Optional data object that was being processed
   * @returns User-friendly error object with message and code
   */
  private handleKnownRequestError(
    error: Prisma.PrismaClientKnownRequestError,
    context?: string,
    data?: any,
  ): { message: string; code: string; details?: any } {
    // Extract target field information if available
    const targetField = error.meta?.target
      ? Array.isArray(error.meta.target)
        ? error.meta.target.join(', ')
        : typeof error.meta.target === 'string'
          ? error.meta.target
          : JSON.stringify(error.meta.target)
      : null;

    // Extract field causing the error (could be string or unknown)
    const fieldName: unknown =
      error.meta?.field_name || error.meta?.field || null;
    const modelName = error.meta?.model_name || error.meta?.modelName || null;
    const cause = error.meta?.cause || null;

    // Convert fieldName to string if it's not null
    let fieldNameStr: string | null = null;
    if (fieldName !== null && fieldName !== undefined) {
      if (typeof fieldName === 'string') {
        fieldNameStr = fieldName;
      } else if (
        typeof fieldName === 'number' ||
        typeof fieldName === 'boolean'
      ) {
        fieldNameStr = String(fieldName);
      } else {
        // For objects and other types, use JSON.stringify
        fieldNameStr = JSON.stringify(fieldName);
      }
    }

    switch (error.code) {
      // Not found errors
      case 'P2001':
        return {
          message: context
            ? `The requested record does not exist for ${context}.`
            : 'The requested record does not exist.',
          code: 'RECORD_NOT_FOUND',
          details: { context, model: modelName },
        };
      case 'P2025':
        return {
          message: context
            ? `The record could not be found while ${context}.`
            : 'The requested record could not be found.',
          code: 'RECORD_NOT_FOUND',
          details: { context, model: modelName, cause },
        };

      // Unique constraint violations
      case 'P2002':
        return {
          message: targetField
            ? `A record with the same ${targetField} already exists. Please use a different value.`
            : 'A record with these unique fields already exists. Please check for duplicates.',
          code: 'UNIQUE_CONSTRAINT_FAILED',
          details: { duplicateFields: targetField, context, model: modelName },
        };

      // Foreign key constraint failures
      case 'P2003': {
        // Try to extract the specific field that failed from the error meta
        let failedField = targetField;

        // Prisma includes field_name in metadata for foreign key violations
        // Format is typically: "tableName_fieldName_fkey (index)"
        if (!failedField && error.meta?.field_name) {
          const fieldNameValue = error.meta.field_name;
          const fieldNameStr =
            typeof fieldNameValue === 'string'
              ? fieldNameValue
              : typeof fieldNameValue === 'number' ||
                  typeof fieldNameValue === 'boolean'
                ? String(fieldNameValue)
                : JSON.stringify(fieldNameValue);
          // Extract the field name from pattern: "table_fieldName_fkey (index)"
          const match = fieldNameStr.match(/^\w+_(\w+)_fkey/);
          if (match) {
            failedField = match[1];
          } else {
            failedField = fieldNameStr;
          }
        }

        // Prisma often includes field_cause in metadata for foreign key violations
        if (!failedField && error.meta?.field_cause) {
          const fieldCauseValue = error.meta.field_cause;
          failedField =
            typeof fieldCauseValue === 'string'
              ? fieldCauseValue
              : typeof fieldCauseValue === 'number' ||
                  typeof fieldCauseValue === 'boolean'
                ? String(fieldCauseValue)
                : JSON.stringify(fieldCauseValue);
        }

        // Sometimes the field is in the meta.target array
        if (
          !failedField &&
          Array.isArray(error.meta?.target) &&
          error.meta.target.length > 0
        ) {
          failedField = error.meta.target[0];
        }

        // Try to extract from the error message itself
        if (!failedField && error.message) {
          // Pattern: Foreign key constraint failed on the field: `fieldName`
          const fieldMatch = error.message.match(
            /Foreign key constraint failed on the field: `([^`]+)`/,
          );
          if (fieldMatch) {
            failedField = fieldMatch[1];
          }
        }

        // Build a more specific message based on the field
        let specificMessage =
          'Cannot complete operation: a referenced record does not exist.';
        let hint = 'Ensure all referenced IDs exist in the database';

        // Helper function to get the actual value that failed
        const getTargetValueStr = (): string => {
          // First try to get the value from the data object if provided
          if (data && failedField && data[failedField]) {
            const value = data[failedField];
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean')
              return String(value);
          }

          // Fallback to error meta if available
          const value = error.meta?.target_value;
          if (!value) return 'provided';
          if (typeof value === 'string') return value;
          if (typeof value === 'number' || typeof value === 'boolean')
            return String(value);
          return 'provided';
        };

        const targetValueStr = getTargetValueStr();

        if (failedField) {
          // Map common field names to user-friendly messages
          const fieldMessages: Record<
            string,
            { message: string; hint: string }
          > = {
            submissionId: {
              message: `The submission with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the submission exists before creating this review.',
            },
            scorecardId: {
              message: `The scorecard with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the scorecard exists before creating this review.',
            },
            resourceId: {
              message: `The resource with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the resource/user exists before creating this record.',
            },
            reviewId: {
              message: `The review with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the review exists before adding items to it.',
            },
            opportunityId: {
              message: `The review opportunity with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the review opportunity exists before creating this application.',
            },
            challengeId: {
              message: `The challenge with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the challenge exists before creating this record.',
            },
            reviewItemId: {
              message: `The review item with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the review item exists before adding comments to it.',
            },
            reviewItemCommentId: {
              message: `The review item comment with ID '${targetValueStr}' does not exist.`,
              hint: 'Please ensure the review item comment exists before creating this appeal.',
            },
          };

          if (fieldMessages[failedField]) {
            specificMessage = fieldMessages[failedField].message;
            hint = fieldMessages[failedField].hint;
          } else {
            // Clean up field name for display
            const cleanField = failedField
              .replace(/([A-Z])/g, ' $1') // Add space before capital letters
              .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
              .replace(/_/g, ' ') // Replace underscores with spaces
              .toLowerCase()
              .trim();

            specificMessage = `Cannot complete operation: the referenced ${cleanField} does not exist.`;
            hint = `Please ensure the ${cleanField} exists before creating this record.`;
          }
        } else {
          // If we still can't identify the field, list common possibilities based on context
          if (context && context.includes('review')) {
            specificMessage =
              'Cannot complete operation: one or more referenced records do not exist. Please check that submissionId, scorecardId, and resourceId are valid.';
            hint =
              'Ensure the submission, scorecard, and resource all exist in the database.';
          }
        }

        return {
          message: specificMessage,
          code: 'FOREIGN_KEY_CONSTRAINT_FAILED',
          details: {
            missingReference: failedField,
            context,
            model: modelName,
            hint,
            originalFieldName: error.meta?.field_name, // Include original field name for debugging
          },
        };
      }

      // Required field constraint violations
      case 'P2004':
      case 'P2011':
        return {
          message: fieldNameStr
            ? `Required field '${fieldNameStr}' is missing or has an invalid value.`
            : 'One or more required fields are missing or have invalid values. Please check all required fields.',
          code: 'REQUIRED_FIELD_MISSING',
          details: {
            missingField: fieldNameStr,
            context,
            model: modelName,
          },
        };

      // Data validation errors
      case 'P2006':
        return {
          message: fieldNameStr
            ? `The value provided for field '${fieldNameStr}' is invalid or in an incorrect format.`
            : 'The provided data is invalid or in an incorrect format.',
          code: 'INVALID_DATA',
          details: { invalidField: fieldNameStr, context, model: modelName },
        };
      case 'P2007':
        return {
          message:
            'Data validation error: The provided data does not match the expected format.',
          code: 'DATA_VALIDATION_ERROR',
          details: { context, model: modelName },
        };
      case 'P2008':
        return {
          message:
            'Failed to parse the query: Please check the query parameters.',
          code: 'QUERY_PARSE_ERROR',
          details: { context },
        };
      case 'P2009':
        return {
          message: 'Query validation failed: Please check the query structure.',
          code: 'QUERY_VALIDATION_ERROR',
          details: { context },
        };
      case 'P2010':
        return {
          message: 'Raw query failed: Please check the SQL syntax.',
          code: 'RAW_QUERY_FAILED',
          details: { context },
        };
      case 'P2012':
        return {
          message: fieldNameStr
            ? `Missing required value for field '${fieldNameStr}'.`
            : 'Missing a required value in the request.',
          code: 'MISSING_REQUIRED_VALUE',
          details: { missingField: fieldNameStr, context, model: modelName },
        };

      // Connection and timeout errors
      case 'P1000':
        return {
          message: 'Authentication failed: Cannot connect to the database.',
          code: 'DATABASE_AUTH_ERROR',
          details: { context },
        };
      case 'P1001':
        return {
          message:
            'Cannot reach the database server. Please check the connection.',
          code: 'DATABASE_UNREACHABLE',
          details: { context },
        };
      case 'P1002':
        return {
          message: 'Database server connection timeout. Please try again.',
          code: 'DATABASE_TIMEOUT',
          details: { context },
        };

      case 'P1008':
        return {
          message:
            'The operation timed out. Please try again with a simpler request.',
          code: 'OPERATION_TIMEOUT',
          details: { context },
        };

      case 'P2024':
        return {
          message:
            'Request timed out while waiting for a database connection from the pool.',
          code: 'CONNECTION_POOL_TIMEOUT',
          details: { context },
        };

      case 'P2034':
        return {
          message:
            'Transaction failed due to a write conflict or deadlock. Please retry the operation.',
          code: 'TRANSACTION_CONFLICT',
          details: { context },
        };

      case 'P2037':
        return {
          message:
            'Too many database connections. The server is experiencing high load.',
          code: 'TOO_MANY_CONNECTIONS',
          details: { context },
        };

      // Query size/complexity limits
      case 'P2026':
        return {
          message:
            'The query is too complex or returns too many results. Please add filters or pagination.',
          code: 'QUERY_TOO_COMPLEX',
          details: { context },
        };
      case 'P2027':
        return {
          message: 'Multiple database errors occurred during query execution.',
          code: 'MULTIPLE_ERRORS',
          details: { context },
        };
      case 'P2028':
        return {
          message: 'Transaction API error. Please check the transaction logic.',
          code: 'TRANSACTION_ERROR',
          details: { context },
        };
      case 'P2029':
        return {
          message:
            'Query parameter limit exceeded. Please reduce the number of parameters.',
          code: 'QUERY_PARAMETER_LIMIT',
          details: { context },
        };

      default:
        return {
          message: context
            ? `A database error occurred while ${context}. Error code: ${error.code}`
            : `A database error occurred. Error code: ${error.code}`,
          code: 'DATABASE_ERROR',
          details: {
            errorCode: error.code,
            context,
            meta: error.meta,
          },
        };
    }
  }

  /**
   * Extract validation details from Prisma validation error messages
   * @param errorMessage The error message from Prisma
   * @returns Parsed validation details
   */
  private extractValidationDetails(errorMessage: string): {
    message?: string;
    fields?: string[];
    requiredFields?: string[];
    invalidFields?: string[];
  } {
    const details: {
      message?: string;
      fields?: string[];
      requiredFields?: string[];
      invalidFields?: string[];
    } = {};

    // Try to extract field names from the error message
    const fieldMatch = errorMessage.match(/Argument `?(\w+)`?/g);
    if (fieldMatch) {
      details.fields = fieldMatch.map((f) => f.replace(/Argument `?|`?/g, ''));
    }

    // Check for missing fields
    const missingMatch = errorMessage.match(
      /Missing the required value at `([^`]+)`/,
    );
    if (missingMatch) {
      details.requiredFields = [missingMatch[1]];
      details.message = `Missing required field: ${missingMatch[1]}`;
    }

    // Check for invalid type
    const typeMatch = errorMessage.match(
      /Invalid value for argument `?(\w+)`?\. Expected (\w+)/,
    );
    if (typeMatch) {
      details.invalidFields = [typeMatch[1]];
      details.message = `Invalid type for field '${typeMatch[1]}'. Expected ${typeMatch[2]}`;
    }

    // Check for unknown fields
    const unknownMatch = errorMessage.match(/Unknown arg(?:ument)? `?(\w+)`?/);
    if (unknownMatch) {
      details.invalidFields = [unknownMatch[1]];
      details.message = `Unknown field '${unknownMatch[1]}' in request`;
    }

    return details;
  }
}
