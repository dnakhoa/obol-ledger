import type { Exchange } from './terminal-timeline';

/**
 * What the hero terminal types, and what Postgres answers.
 *
 * The replies are the database's own words, copied from the triggers and
 * policies in `drizzle/` and printed the way `/break` prints them: SQLSTATE
 * and condition first, then the message. If a migration rewords one of these,
 * this is the second place to change — and the attack page, which shows the
 * live answer, is where a mismatch would be noticed.
 *
 * Not translated: psql prints English in every language Postgres runs in.
 */
export const REFUSALS: readonly Exchange[] = [
  {
    statement:
      "UPDATE postings\n   SET amount_minor = amount_minor * 10\n WHERE id = 'post_01M3AC4HGWX';",
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
    statement:
      "INSERT INTO postings (transaction_id, account_id, amount_minor)\nVALUES ('txn_01M3AC6X', 'acct_cash',   1000),\n       ('txn_01M3AC6X', 'acct_sales', -999);\nCOMMIT;",
    reply: [
      { tone: 'error', text: 'ERROR:  23514 check_violation' },
      {
        tone: 'detail',
        text: 'transaction txn_01M3AC6X is unbalanced by 1 minor units of the functional currency',
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
      "INSERT INTO accounts (id, org_id, name, currency)\nVALUES ('acct_planted', 'org_SOMEONE_ELSE', 'Planted', 'VND');",
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
