import { PrismaPg } from '@prisma/adapter-pg';

export function createPostgresAdapter(
  connectionString: string | undefined,
): PrismaPg {
  if (!connectionString) {
    throw new Error('A PostgreSQL connection URL is required');
  }
  const schema =
    new URL(connectionString).searchParams.get('schema') || undefined;
  return new PrismaPg({ connectionString }, { schema });
}
