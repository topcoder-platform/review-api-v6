'use strict';

const generated = require('./generated');

/**
 * Create a review database client without exposing Prisma 6 constructor
 * details to downstream services.
 *
 * @param {string} connectionString PostgreSQL connection string for review DB.
 * @returns {import('./generated').PrismaClient} Connected-on-first-use client.
 * @throws {TypeError} When connectionString is missing or blank.
 */
function createReviewPrismaClient(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new TypeError(
      'A non-empty review database connection string is required.',
    );
  }

  return new generated.PrismaClient({
    datasources: {
      db: {
        url: connectionString.trim(),
      },
    },
  });
}

module.exports = {
  ...generated,
  createReviewPrismaClient,
};
