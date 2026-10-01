import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFUSALS } from '@/components/landing/refusal-script';
import { commitReply } from '@/components/landing/balance';

/**
 * The landing page quotes Postgres. This checks it still does.
 *
 * Every message it prints must be one a migration raises, with each `%` the
 * trigger fills standing for whatever it filled in. A migration that rewords
 * a refusal fails here, rather than leaving the page quoting a sentence the
 * database no longer says — on the one page whose argument is that every
 * line of it is literally true.
 */

const DRIZZLE = join(import.meta.dirname, '..', '..', 'drizzle');

/** Postgres' own messages, which no migration writes. */
const BUILT_IN = new Set(['new row violates row-level security policy for table "accounts"']);

function raisedMessages(): RegExp[] {
  const sql = readdirSync(DRIZZLE)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(DRIZZLE, file), 'utf8'))
    .join('\n')
    // Comments first: one apostrophe in "don't" puts every quote after it
    // out of step, and the literals come out inside-out.
    .replaceAll(/--[^\n]*/gu, '');
  return [...sql.matchAll(/'((?:[^'\n]|'')+)'/gu)]
    .map((match) => (match[1] ?? '').replaceAll("''", "'"))
    .filter((literal) => literal.includes(' '))
    .map((literal) => {
      const escaped = literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return new RegExp(`^${escaped.replaceAll('%', '\\S+')}$`, 'u');
    });
}

const quoted = [...REFUSALS.flatMap((exchange) => exchange.reply), ...commitReply(1000, 999)]
  .filter((line) => line.tone === 'detail')
  .map((line) => line.text);

describe('what the landing page says Postgres says', () => {
  const messages = raisedMessages();

  it('found the migrations and something to check', () => {
    expect(messages.length).toBeGreaterThan(10);
    expect(quoted.length).toBeGreaterThanOrEqual(5);
  });

  it.each(quoted)('%s', (text) => {
    if (BUILT_IN.has(text)) return;
    expect(messages.some((message) => message.test(text))).toBe(true);
  });
});
