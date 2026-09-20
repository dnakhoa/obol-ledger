import { sql } from 'drizzle-orm';
import journal from '../../../drizzle/meta/_journal.json';
import type { Database } from './types';

/**
 * Is the database's schema the one this code was built against?
 *
 * Asked rather than assumed, for the same reason tenant isolation is asked
 * rather than assumed: the failure is silent from the application's point of
 * view and catastrophic from the user's. Ship code that reads a column the
 * database does not have and every page answers 500 with a Postgres error
 * naming a column, which tells an operator nothing about *why* it is missing.
 *
 * The journal is bundled with the application, so "what this build expects" is
 * a fact the running process already knows. The database records what it has
 * actually applied. Comparing the two turns a confusing 500 into a sentence.
 *
 * Reported rather than enforced. A process that refused to start on a pending
 * migration would take the whole site down for an *additive* change that the
 * running code is perfectly happy without — which is the normal case during a
 * deploy, and is exactly the window expand-only migrations exist to make safe.
 */

type JournalEntry = { readonly idx: number; readonly when: number; readonly tag: string };

const ENTRIES = (journal as { entries: JournalEntry[] }).entries;

export type SchemaVersion = {
  /** The last migration this build ships. */
  readonly expected: string | null;
  /** The last migration the database has applied. */
  readonly applied: string | null;
  readonly upToDate: boolean;
  /** Migrations this build carries that the database has not run. */
  readonly pending: readonly string[];
  /**
   * True when the database is *ahead* — it has applied something this build
   * has never heard of. Normal for a few seconds mid-deploy, and a signal that
   * somebody rolled back the code but not the schema if it persists.
   */
  readonly ahead: boolean;
  /**
   * Whether the bookkeeping table could be read at all.
   *
   * Not the same question as whether anything is pending, and conflating them
   * is how this check first shipped: the application connects as a role with
   * no rights on the `drizzle` schema, the query threw, and the probe
   * confidently reported that a fully migrated production database had never
   * been migrated. A diagnostic that lies in the direction of alarm is worse
   * than none, because the next person to see it believes it.
   */
  readonly readable: boolean;
};

/**
 * The comparison, with no database in it.
 *
 * Split out so the interesting half can be tested by handing it a number.
 * "What does a build do when the database is three migrations behind" is a
 * question about arithmetic on a list, and needing Postgres to answer it is
 * how that path ends up untested.
 */
export function compareSchema(appliedAt: number | null, readable = true): SchemaVersion {
  const latest = ENTRIES.at(-1) ?? null;
  const expected = latest?.tag ?? null;

  if (!readable) {
    // Nothing is claimed about what is pending, because nothing is known.
    return { expected, applied: null, upToDate: false, pending: [], ahead: false, readable: false };
  }

  if (appliedAt === null) {
    return {
      expected,
      applied: null,
      upToDate: false,
      pending: ENTRIES.map((entry) => entry.tag),
      ahead: false,
      readable: true,
    };
  }

  const pending = ENTRIES.filter((entry) => entry.when > appliedAt).map((entry) => entry.tag);
  const known = ENTRIES.find((entry) => entry.when === appliedAt);

  return {
    expected,
    applied: known?.tag ?? `unknown (${appliedAt})`,
    upToDate: pending.length === 0 && known !== undefined,
    pending,
    ahead: known === undefined && appliedAt > (latest?.when ?? 0),
    readable: true,
  };
}

export async function checkSchemaVersion(database: Database): Promise<SchemaVersion> {
  try {
    // `created_at` holds the journal's `when`, which is what makes the two
    // sides comparable without hashing every file.
    const result = await database.execute<{ created_at: string | number }>(
      sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    const row = (result as unknown as { rows?: { created_at: string | number }[] }).rows?.[0];
    return compareSchema(row ? Number(row.created_at) : null);
  } catch {
    // Could not read it. That is not the same as "never migrated" — the
    // application's role may simply have no rights on the `drizzle` schema —
    // and saying so is the whole point of the distinction.
    return compareSchema(null, false);
  }
}
