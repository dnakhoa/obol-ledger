import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every scheduled path answers the method the scheduler sends.
 *
 * Vercel Cron issues a GET. The dispatch route exported only POST, so every
 * scheduled run was a 405 and the outbox drained only when somebody pressed
 * "dispatch now" — nothing failed loudly, because a cron that is refused is a
 * cron that did nothing, which looks exactly like a quiet day.
 */
const ROOT = join(import.meta.dirname, '..', '..');

const crons = (
  JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
    crons?: { path: string }[];
  }
).crons;

describe('scheduled jobs', () => {
  it('has at least one to check', () => {
    expect(crons?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(crons ?? [])('$path exports GET', async ({ path }) => {
    const route = (await import(`@/app${path}/route`)) as Record<string, unknown>;
    expect(typeof route['GET']).toBe('function');
  });
});
