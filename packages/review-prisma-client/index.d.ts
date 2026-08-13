export * from './generated';

import type { PrismaClient } from './generated';

/**
 * Creates a review-api-v6 Prisma client configured for one PostgreSQL URL.
 *
 * @param connectionString PostgreSQL URL for the review database.
 * @returns A lazy Prisma client; callers must invoke `$disconnect` on shutdown.
 * @throws TypeError when the connection string is blank.
 */
export declare function createReviewPrismaClient(
  connectionString: string,
): PrismaClient;
