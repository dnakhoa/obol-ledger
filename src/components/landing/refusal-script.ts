import type { Exchange } from './terminal-timeline';

/**
 * What the hero terminal types, and what Postgres answers.
 *
 * Each statement is the one `/break` runs for the same attack
 * (`src/server/services/attacks.ts`), shortened only in its identifiers —
 * every NOT NULL column is there, because a statement missing one would be
 * refused for that instead, and the page would be quoting an answer
 * Postgres never gives. The replies are the database's own words: the
 * messages come from the triggers in `drizzle/`, which
 * `tests/unit/landing-quotes.test.ts` checks, and are printed the way `/break`
 * prints them — SQLSTATE and condition, then the message.
 *
 * Not translated: psql prints English in every language Postgres runs in.
 */
export const REFUSALS: readonly Exchange[] = [
  {
    statement:
      "UPDATE postings\n   SET amount_minor = amount_minor * 10,\n       base_amount_minor = base_amount_minor * 10\n WHERE id = 'post_01M3AC4HGWX';",
    reply: [
      { tone: 'error', text: 'ERROR:  23001 restrict_violation' },
      {
        tone: 'detail',
        text: 'postings is append-only; UPDATE is not permitted. Post a reversing entry instead.',
      },
      { tone: 'muted', text: 'ROLLBACK' },
    ],
  },
  {
    statement: [
      'BEGIN;',
      'INSERT INTO transactions',
      '  (id, org_id, description, currency, occurred_at)',
      "VALUES ('txn_01M3', 'org_01M3', 'Off by one', 'VND', now());",
      'INSERT INTO postings',
      '  (id, org_id, transaction_id, account_id,',
      '   amount_minor, currency, base_amount_minor, fx_rate, sequence)',
      "VALUES ('post_01', 'org_01M3', 'txn_01M3', 'acct_cash',",
      "         1000, 'VND',  1000, 1, 0),",
      "       ('post_02', 'org_01M3', 'txn_01M3', 'acct_sales',",
      "         -999, 'VND', -999, 1, 1);",
      // The balance check is deferred to COMMIT; this asks for it now, as
      // the attack page does, so the transaction can still be rolled back.
      'SET CONSTRAINTS ALL IMMEDIATE;',
    ].join('\n'),
    reply: [
      { tone: 'muted', text: 'BEGIN' },
      { tone: 'muted', text: 'INSERT 0 1' },
      { tone: 'muted', text: 'INSERT 0 2' },
      { tone: 'error', text: 'ERROR:  23514 check_violation' },
      {
        tone: 'detail',
        text: 'transaction txn_01M3 is unbalanced by 1 minor units of the functional currency',
      },
      { tone: 'muted', text: 'ROLLBACK' },
    ],
  },
  {
    statement: "DELETE FROM transactions\n WHERE id = 'txn_01M3AC6X';",
    reply: [
      { tone: 'error', text: 'ERROR:  23001 restrict_violation' },
      {
        tone: 'detail',
        text: 'transactions is append-only; DELETE is not permitted. Post a reversing entry instead.',
      },
      { tone: 'muted', text: 'ROLLBACK' },
    ],
  },
  {
    statement:
      "INSERT INTO accounts\n  (id, org_id, name, type, currency)\nVALUES ('acct_planted', 'org_SOMEONE_ELSE',\n        'Planted', 'asset', 'VND');",
    reply: [
      { tone: 'error', text: 'ERROR:  42501 insufficient_privilege' },
      {
        tone: 'detail',
        text: 'new row violates row-level security policy for table "accounts"',
      },
      { tone: 'muted', text: 'ROLLBACK' },
    ],
  },
];
