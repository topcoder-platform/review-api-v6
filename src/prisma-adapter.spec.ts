import { PrismaClient } from '@prisma/client';
import { createPostgresAdapter } from './prisma-adapter';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseTest = databaseUrl ? it : it.skip;

databaseTest(
  'resolves unqualified raw SQL in the configured schema',
  async () => {
    const url = new URL(databaseUrl!);
    url.searchParams.set('schema', 'information_schema');
    const prisma = new PrismaClient({
      adapter: createPostgresAdapter(url.href),
    });
    try {
      const rows = await prisma.$queryRaw`
        SELECT current_schema()::text AS schema FROM "tables" LIMIT 1
      `;
      expect(rows).toEqual([{ schema: 'information_schema' }]);
    } finally {
      await prisma.$disconnect();
    }
  },
);
