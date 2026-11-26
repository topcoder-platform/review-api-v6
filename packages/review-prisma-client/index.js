'use strict';

const generated = require('./generated');
const { PrismaPg } = require('@prisma/adapter-pg');

/**
 * Create a review database client without exposing Prisma constructor
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

  const url = connectionString.trim();
  const schema = new URL(url).searchParams.get('schema') || undefined;
  return new generated.PrismaClient({
    adapter: new PrismaPg({ connectionString: url }, { schema }),
  });
}

module.exports = {
  ...generated,
  createReviewPrismaClient,
};
