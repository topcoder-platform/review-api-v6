import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { LoggerService } from './logger.service';
import { PrismaErrorService } from './prisma-error.service';
import { getStore } from 'src/shared/request/requestStore';
import { Utils } from './utils.service';

enum auditField {
  createdBy = 'createdBy',
  updatedBy = 'updatedBy',
}

/**
 * Checks if a given Prisma model contains a specific field.
 *
 * @param model - The name of the Prisma model to search for.
 * @param field - The name of the field to check within the model.
 * @returns `true` if the model contains the specified field, otherwise `false`.
 */
const modelHasField = (model: string, field: string) => {
  const modelObj = Prisma.dmmf?.datamodel?.models?.find(
    (x) => x.name === model,
  );
  return modelObj && modelObj.fields?.some((x) => x.name === field);
};

/**
 * Retrieves the type of a specified field from a given Prisma model.
 *
 * @param model - The name of the Prisma model to search for.
 * @param field - The name of the field within the model whose type is to be retrieved.
 * @returns The type of the specified field as a string, or `undefined` if the model or field does not exist.
 */
const getFieldType = (model: string, field: string) => {
  const modelObj = Prisma.dmmf?.datamodel?.models?.find(
    (x) => x.name === model,
  );
  return modelObj && modelObj.fields?.find((x) => x.name === field)?.type;
};

/**
 * Checks an object's properties for nested 'update' or 'create' operations,
 * and applies the `addUserAuditField` function to those operations.
 *
 * Iterates over the object's entries, filtering for values that are objects
 * containing either an 'update' or 'create' key. For each matching entry,
 * it determines the field type using `getFieldType`, and then calls
 * `addUserAuditField` with the appropriate parameters.
 *
 * @param model - The name of the model being audited.
 * @param field - The audit field information.
 * @param obj - The object to inspect for nested update or create operations.
 */
const checkForNestedUpdateCreateOps = (
  model: string,
  field: auditField,
  obj: object,
) => {
  Object.entries(obj)
    .filter(
      ([key, value]) =>
        value &&
        typeof value === 'object' &&
        ('update' in value || 'create' in value) &&
        getFieldType(model, key),
    )
    .forEach(([key, value]) => {
      const nestedModel = getFieldType(model, key);
      if (!nestedModel) {
        return;
      }

      const nestedContainer = value as Record<string, any>;
      const nestedCreate = nestedContainer.create as
        | object
        | Array<object>
        | undefined;
      const nestedUpdate = nestedContainer.update as
        | object
        | Array<object>
        | undefined;

      if (nestedCreate) {
        // Nested creates should receive both createdBy and updatedBy fields.
        addUserAuditField(nestedModel, auditField.createdBy, nestedCreate);
        addUserAuditField(nestedModel, auditField.updatedBy, nestedCreate);
      }

      if (nestedUpdate) {
        addUserAuditField(nestedModel, field, nestedUpdate);
      }
    });
};

/**
 * Adds a user audit field to the provided data object(s) if the current user ID is available
 * and the specified model contains the audit field. Handles both single objects and arrays of objects.
 * Also checks for nested update/create operations within the data.
 *
 * @param model - The name of the model to check for the audit field.
 * @param field - The audit field to add (e.g., createdBy, updatedBy).
 * @param data - The object or array of objects to which the audit field should be added.
 */
const addUserAuditField = (
  model: string,
  field: auditField,
  data?: object | Array<object>,
) => {
  const userId = getStore()?.userId;

  if (!data || !userId || !modelHasField(model, field)) {
    return;
  }

  if (Array.isArray(data)) {
    data.forEach((item) => {
      const record = item as Record<string, any>;
      record[field] = userId;
      checkForNestedUpdateCreateOps(model, field, record);
    });
  } else {
    const record = data as Record<string, any>;
    record[field] = userId;
    checkForNestedUpdateCreateOps(model, field, record);
  }
};

export const __test__ = {
  auditField,
  addUserAuditField,
  checkForNestedUpdateCreateOps,
};

/**
 * Prisma extension that automatically adds audit fields (`createdBy`, `updatedBy`)
 * to all models during create, update, and upsert operations.
 *
 * - On `create` and `createMany`, both `createdBy` and `updatedBy` fields are set.
 * - On `update` and `updateMany`, only the `updatedBy` field is set.
 * - On `upsert`, sets `createdBy` and `updatedBy` on creation, and `updatedBy` on update.
 *
 * This extension relies on the `addUserAuditField` helper to inject audit information
 * into the model's data payload before executing the query.
 *
 * @see addUserAuditField
 * @see auditField
 */
const auditFieldsExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        addUserAuditField(model, auditField.createdBy, args.data);
        addUserAuditField(model, auditField.updatedBy, args.data);
        return query(args);
      },

      async createMany({ model, args, query }) {
        addUserAuditField(model, auditField.createdBy, args.data);
        addUserAuditField(model, auditField.updatedBy, args.data);
        return query(args);
      },

      async update({ model, args, query }) {
        addUserAuditField(model, auditField.updatedBy, args.data);
        return query(args);
      },

      async updateMany({ model, args, query }) {
        addUserAuditField(model, auditField.updatedBy, args.data);
        return query(args);
      },

      async upsert({ model, args, query }) {
        if (args.create) {
          addUserAuditField(model, auditField.createdBy, args.create);
          addUserAuditField(model, auditField.updatedBy, args.create);
        }

        if (args.update) {
          addUserAuditField(model, auditField.updatedBy, args.update);
        }

        return query(args);
      },
    },
  },
});

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger: LoggerService;

  constructor(private readonly prismaErrorService?: PrismaErrorService) {
    // Get the schema name from environment variable or use 'public' as default
    const schema = process.env.POSTGRES_SCHEMA || 'public';

    super({
      ...Utils.getPrismaTimeout(),
      log: [
        { level: 'query', emit: 'event' },
        { level: 'info', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
      // Set connection pool configuration
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    this.logger = LoggerService.forRoot('PrismaService');
    this.logger.log(`Using PostgreSQL schema: ${schema}`);

    // Setup logging for Prisma queries and errors
    this.$on('query' as never, (e: Prisma.QueryEvent) => {
      const queryTime = e.duration;

      // Log query details - full query for dev, just time for production
      if (process.env.NODE_ENV !== 'production') {
        this.logger.debug(
          `Query: ${e.query} | Params: ${e.params} | Duration: ${queryTime}ms`,
        );
      } else if (queryTime > 500) {
        // In production, only log slow queries (> 500ms)
        this.logger.warn(
          `Slow query detected! Duration: ${queryTime}ms | Query: ${e.query}`,
        );
      }
    });

    this.$on('info' as never, (e: Prisma.LogEvent) => {
      this.logger.log(`Prisma Info: ${e.message}`);
    });

    this.$on('warn' as never, (e: Prisma.LogEvent) => {
      this.logger.warn(`Prisma Warning: ${e.message}`);
    });

    this.$on('error' as never, (e: Prisma.LogEvent) => {
      this.logger.error(`Prisma Error: ${e.message}`, e.target);
    });

    // Extend the client and replace this instance with the extended instance
    Object.assign(this, this.$extends(auditFieldsExtension));
  }

  async onModuleInit() {
    this.logger.log('Initializing Prisma connection');
    try {
      await this.$connect();
      this.logger.log('Prisma connected successfully');

      // Configure query performance
      if (process.env.NODE_ENV === 'production') {
        try {
          this.logger.log('Database connection pool configured');
        } catch (error) {
          this.logger.warn(
            `Could not configure database connections: ${error.message}`,
          );
        }
      }
    } catch (error) {
      const errorMsg = this.prismaErrorService
        ? this.prismaErrorService.handleError(error, 'connecting to database')
            .message
        : error.message;

      this.logger.error(
        `Failed to connect to the database: ${errorMsg}`,
        error.stack,
      );
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Prisma');
    await this.$disconnect();
  }
}
