import { describe, expect, it } from 'vitest';
import { compareSchema } from '@/server/db/schema-version';
import journal from '../../drizzle/meta/_journal.json';

/**
 * Schema drift, which is how production broke.
 *
 * Code was merged that read a column the database did not have, and every page
 * answered 500 with a Postgres error naming the column — which says nothing
 * about why it was missing. These are the states worth telling apart, and the
 * comparison is pure so they can be checked by handing it a number.
 */
const entries = (journal as { entries: { when: number; tag: string }[] }).entries;
const last = entries.at(-1);
const secondToLast = entries.at(-2);

describe('schema version', () => {
  it('is up to date when the database has the last migration this build ships', () => {
    expect(last).toBeDefined();
    if (!last) return;

    const version = compareSchema(last.when);
    expect(version.upToDate).toBe(true);
    expect(version.pending).toEqual([]);
    expect(version.applied).toBe(last.tag);
    expect(version.expected).toBe(last.tag);
  });

  it('names the migrations that have not run', () => {
    // The state that took the site down: the code is ahead of the schema.
    expect(secondToLast).toBeDefined();
    if (!secondToLast || !last) return;

    const version = compareSchema(secondToLast.when);
    expect(version.upToDate).toBe(false);
    expect(version.pending).toEqual([last.tag]);
    expect(version.applied).toBe(secondToLast.tag);
  });

  it('treats a database that has never been migrated as every migration pending', () => {
    const version = compareSchema(null);
    expect(version.upToDate).toBe(false);
    expect(version.applied).toBeNull();
    expect(version.pending).toHaveLength(entries.length);
  });

  it('notices a database that is ahead of the code', () => {
    // Somebody rolled the deployment back and left the schema where it was.
    // Harmless for a few seconds mid-deploy; a real problem if it persists,
    // and indistinguishable from "fine" without saying so.
    const version = compareSchema((last?.when ?? 0) + 1_000);
    expect(version.ahead).toBe(true);
    expect(version.upToDate).toBe(false);
    expect(version.applied).toMatch(/^unknown/u);
  });
});
