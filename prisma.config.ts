import { relative, resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

const datasourceUrls: Record<string, string | undefined> = {
  'prisma/challenge-schema.prisma': process.env.CHALLENGE_DB_URL,
  'prisma/member-schema.prisma': process.env.MEMBER_DB_URL,
  'prisma/resource-schema.prisma': process.env.RESOURCE_DB_URL,
  'prisma/schema.prisma': process.env.DATABASE_URL,
};

const schemaFlag = process.argv.findIndex(arg => arg === '--schema' || arg.startsWith('--schema='));
const selected = schemaFlag < 0
  ? 'prisma/schema.prisma'
  : process.argv[schemaFlag].split('=')[1] || process.argv[schemaFlag + 1];
const schema = relative(process.cwd(), resolve(selected));
if (!Object.prototype.hasOwnProperty.call(datasourceUrls, schema)) throw new Error(`Unknown Prisma schema: ${schema}`);

export default defineConfig({
  schema,
  migrations: { seed: 'node dist/prisma/migrate.js' },
  datasource: { url: datasourceUrls[schema] },
});
