import { PrismaPg } from '@prisma/adapter-pg';

export function createPostgresAdapter(
  connectionString: string | undefined,
): PrismaPg {
  if (!connectionString) {
    throw new Error('A PostgreSQL connection URL is required');
  }
  const schema =
    new URL(connectionString).searchParams.get('schema') || undefined;
  if (!schema) {
    return new PrismaPg({ connectionString });
  }

  // Prisma qualifies generated queries. Raw SQL relies on the session search path.
  return new PrismaPg(
    {
      connectionString,
      // pg-pool awaits this hook before checkout, though @types/pg declares it void.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onConnect: async (client) => {
        await client.query(
          "SELECT pg_catalog.set_config('search_path', pg_catalog.quote_ident($1), false)",
          [schema],
        );
      },
    },
    { schema },
  );
}
