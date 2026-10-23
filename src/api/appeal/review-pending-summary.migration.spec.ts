import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '../../../prisma/migrations');
const FUNCTION_DEFINITION =
  'FUNCTION reviews.update_review_pending_summary_for_resource';

/**
 * Loads the newest migration that defines the pending-appeal summary function.
 * Prisma applies migrations in folder-name order, so the last match is the
 * definition production runs when appeal and appeal response triggers fire.
 *
 * @returns The migration folder name and its SQL text.
 * @throws Error when no migration defines the function.
 */
function loadLatestPendingSummaryFunction(): { name: string; sql: string } {
  const definitions = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'),
    }))
    .filter(({ sql }) => sql.includes(FUNCTION_DEFINITION));

  const latest = definitions[definitions.length - 1];
  if (!latest) {
    throw new Error(`No migration defines ${FUNCTION_DEFINITION}`);
  }
  return latest;
}

describe('update_review_pending_summary_for_resource migration', () => {
  const { name, sql } = loadLatestPendingSummaryFunction();

  it('is redefined after the original pending summary migration', () => {
    expect(name > '20251102001629_add_review_pending_summary').toBe(true);
  });

  it('pins the reviewer-first index plan used by appeal response inserts', () => {
    expect(sql).toContain('SET join_collapse_limit = 1');
    expect(sql).toContain('SET enable_hashjoin = off');
    expect(sql).toContain('SET enable_mergejoin = off');
    expect(sql).toContain('SET max_parallel_workers_per_gather = 0');
  });

  it('joins from the reviewer reviews down to appeals in written order', () => {
    const joinOrder = [
      'FROM reviews.review rv',
      'JOIN reviews."reviewItem" ri',
      'JOIN reviews."reviewItemComment" ric',
      'JOIN reviews.appeal ap',
      'LEFT JOIN reviews."appealResponse" apr',
    ].map((fragment) => sql.indexOf(fragment));

    expect(joinOrder.every((position) => position >= 0)).toBe(true);
    expect([...joinOrder].sort((a, b) => a - b)).toEqual(joinOrder);
    expect(sql).toContain('WHERE rv."resourceId" = p_resource_id');
  });
});
