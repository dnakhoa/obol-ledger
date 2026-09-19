import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { describeTarget, schemaConnectionString, sslFor } from './connection';

/**
 * Measures the pagination claim instead of asserting it.
 *
 * `docs/adr/0006-keyset-pagination.md` says `OFFSET` makes Postgres walk and
 * discard rows, so deep pages get linearly worse while a keyset seek stays
 * flat. That is textbook, which is exactly why it is worth checking: textbook
 * claims are the ones nobody verifies, and an index that is silently unused
 * turns the whole argument into decoration.
 *
 * This loads a synthetic ledger, runs both queries at increasing depth, and
 * writes the timings *and the query plans* to `docs/benchmarks.md`. The plan is
 * the part that matters — a number can be explained away, but `Index Cond`
 * versus `Seq Scan` cannot.
 *
 *   CONCURRENCY_DATABASE_URL=… pnpm benchmark
 */
const ENTRIES = Number(process.env['BENCHMARK_ENTRIES'] ?? 200_000);
const PAGE_SIZE = 25;
const DEPTHS = [1, 100, 1_000, 5_000] as const;
const REPEATS = 5;

type Measurement = {
  readonly depth: number;
  readonly keysetMs: number;
  readonly offsetMs: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

async function main(): Promise<void> {
  const url = schemaConnectionString();
  const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 1 });
  const db = drizzle(pool);

  try {
    console.log(`benchmarking ${describeTarget(url)}`);
    await migrate(db, { migrationsFolder: './drizzle' });

    const orgId = 'org_benchmark';
    console.log(`loading ${ENTRIES.toLocaleString('en-US')} entries…`);
    await load(db, orgId);

    // The measurement runs as the application does: inside a tenant context,
    // so the row-level security predicate is part of what is being timed.
    await db.execute(sql`select set_config('app.current_org', ${orgId}, false)`);

    const measurements: Measurement[] = [];
    for (const depth of DEPTHS) {
      const offsetRows = depth * PAGE_SIZE;
      const cursor = await cursorAtDepth(db, offsetRows);

      const keyset: number[] = [];
      const offset: number[] = [];
      for (let run = 0; run < REPEATS; run += 1) {
        keyset.push(await time(() => keysetPage(db, cursor)));
        offset.push(await time(() => offsetPage(db, offsetRows)));
      }

      measurements.push({
        depth,
        keysetMs: median(keyset),
        offsetMs: median(offset),
      });
      console.log(
        `  page ${String(depth).padStart(5)}  keyset ${median(keyset).toFixed(2)}ms   offset ${median(offset).toFixed(2)}ms`,
      );
    }

    const deepest = DEPTHS.at(-1) ?? 1;
    const cursor = await cursorAtDepth(db, deepest * PAGE_SIZE);
    const keysetPlan = await explain(db, keysetSql(cursor));
    const offsetPlan = await explain(db, offsetSql(deepest * PAGE_SIZE));

    writeFileSync('docs/benchmarks.md', report(measurements, keysetPlan, offsetPlan));
    console.log('wrote docs/benchmarks.md');
  } finally {
    await pool.end();
  }
}

/**
 * Builds the fixture with one bulk statement rather than through the service.
 *
 * Two hundred thousand entries through `postEntry` would take an hour and
 * measure the service, not the index. The rows are shaped exactly as the
 * service writes them — balanced pairs, ULID ids, spread over time — because
 * the query plan depends on the data distribution, not on how it arrived.
 */
async function load(db: ReturnType<typeof drizzle>, orgId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${orgId}, 'Benchmark', 'benchmark')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`select set_config('app.current_org', ${orgId}, false)`);

  const [existing] = await db
    .execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM transactions`)
    .then((result) => result.rows);
  if (Number(existing?.count ?? 0) >= ENTRIES) {
    console.log('fixture already loaded, reusing it');
    return;
  }

  await db.execute(sql`
    INSERT INTO accounts (id, org_id, name, type, currency, overdraft_allowed)
    VALUES
      ('acct_benchmark_cash', ${orgId}, 'Cash', 'asset', 'USD', true),
      ('acct_benchmark_rev',  ${orgId}, 'Revenue', 'revenue', 'USD', true)
    ON CONFLICT (id) DO NOTHING
  `);

  // The append-only and balance triggers exist to protect the ledger from the
  // application; a fixture loader is not the application. They come off for
  // the bulk load and straight back on, and the balance cache is recomputed
  // from the postings afterwards so it stays truthful.
  await db.execute(sql`ALTER TABLE postings DISABLE TRIGGER postings_maintain_balance`);
  await db.execute(sql`ALTER TABLE postings DISABLE TRIGGER postings_balanced`);

  await db.execute(sql`
    INSERT INTO transactions (id, org_id, description, currency, occurred_at)
    SELECT
      'txn_bench_' || lpad(series::text, 9, '0'),
      ${orgId},
      'Benchmark entry ' || series,
      'USD',
      now() - make_interval(secs => series)
    FROM generate_series(1, ${ENTRIES}) AS series
  `);

  await db.execute(sql`
    INSERT INTO postings (id, org_id, transaction_id, account_id, amount_minor, currency, sequence)
    SELECT
      'post_bench_' || lpad(series::text, 9, '0') || '_' || side,
      ${orgId},
      'txn_bench_' || lpad(series::text, 9, '0'),
      CASE WHEN side = 0 THEN 'acct_benchmark_cash' ELSE 'acct_benchmark_rev' END,
      CASE WHEN side = 0 THEN 1000 ELSE -1000 END,
      'USD',
      side
    FROM generate_series(1, ${ENTRIES}) AS series, generate_series(0, 1) AS side
  `);

  await db.execute(sql`ALTER TABLE postings ENABLE TRIGGER postings_maintain_balance`);
  await db.execute(sql`ALTER TABLE postings ENABLE TRIGGER postings_balanced`);

  await db.execute(sql`
    UPDATE accounts a
       SET balance_minor = coalesce(
         (SELECT sum(p.amount_minor) FROM postings p WHERE p.account_id = a.id), 0)
     WHERE a.org_id = ${orgId}
  `);

  // Without fresh statistics the planner is choosing from a guess, and the
  // comparison would measure that guess rather than the indexes.
  await db.execute(sql`ANALYZE transactions`);
  await db.execute(sql`ANALYZE postings`);
  await db.execute(sql`ANALYZE accounts`);
}

function keysetSql(cursor: { occurredAt: string; id: string }) {
  return sql`
    SELECT id, occurred_at FROM transactions
     WHERE (occurred_at, id) < (${cursor.occurredAt}::timestamptz, ${cursor.id})
     ORDER BY occurred_at DESC, id DESC
     LIMIT ${PAGE_SIZE}
  `;
}

function offsetSql(offset: number) {
  return sql`
    SELECT id, occurred_at FROM transactions
     ORDER BY occurred_at DESC, id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;
}

async function cursorAtDepth(
  db: ReturnType<typeof drizzle>,
  offset: number,
): Promise<{ occurredAt: string; id: string }> {
  const result = await db.execute<{ id: string; occurred_at: string }>(sql`
    SELECT id, occurred_at::text AS occurred_at FROM transactions
     ORDER BY occurred_at DESC, id DESC
     LIMIT 1 OFFSET ${offset}
  `);
  const row = result.rows[0];
  if (!row) throw new Error(`no row at offset ${offset}; load more entries`);
  return { occurredAt: row.occurred_at, id: row.id };
}

async function keysetPage(
  db: ReturnType<typeof drizzle>,
  cursor: { occurredAt: string; id: string },
) {
  await db.execute(keysetSql(cursor));
}

async function offsetPage(db: ReturnType<typeof drizzle>, offset: number) {
  await db.execute(offsetSql(offset));
}

async function time(work: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

async function explain(db: ReturnType<typeof drizzle>, query: ReturnType<typeof sql>) {
  const result = await db.execute<{ 'QUERY PLAN': string }>(
    sql`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${query}`,
  );
  return result.rows.map((row) => row['QUERY PLAN']).join('\n');
}

function report(measurements: Measurement[], keysetPlan: string, offsetPlan: string): string {
  const rows = measurements
    .map((m) => {
      const ratio = m.keysetMs === 0 ? '—' : `${(m.offsetMs / m.keysetMs).toFixed(1)}×`;
      return `| ${m.depth.toLocaleString('en-US')} | ${m.keysetMs.toFixed(2)} ms | ${m.offsetMs.toFixed(2)} ms | ${ratio} |`;
    })
    .join('\n');

  return `# Pagination benchmark

<!-- Generated by \`pnpm benchmark\`. Do not edit by hand. -->

[ADR 6](adr/0006-keyset-pagination.md) claims that \`OFFSET\` makes Postgres walk
and discard rows, so deep pages degrade linearly, while a keyset seek stays
flat. This measures it rather than asserting it.

**Fixture**: ${ENTRIES.toLocaleString('en-US')} entries, ${(ENTRIES * 2).toLocaleString('en-US')} postings, one tenant.
Page size ${PAGE_SIZE}. Median of ${REPEATS} runs. Run inside a tenant context, so the
row-level security predicate is part of what is timed.

| Page | Keyset | OFFSET | OFFSET cost |
|---:|---:|---:|---:|
${rows}

## Why

The timings are suggestive; the plans are the evidence. A number can be
explained away as noise or a cold cache — \`Index Cond\` versus rows discarded
cannot.

### Keyset, deepest page

\`\`\`
${keysetPlan}
\`\`\`

The row-wise comparison \`(occurred_at, id) < (…)\` becomes an \`Index Cond\`, so
Postgres descends the \`(occurred_at, id)\` index straight to the cursor and
reads ${PAGE_SIZE} rows. Depth does not appear in the work.

### OFFSET, deepest page

\`\`\`
${offsetPlan}
\`\`\`

Note the rows removed before the limit is applied. That work is proportional to
the offset, which is why the right-hand column grows, and it is also why an
insert during paging shifts every subsequent page — the offset is a position in
a result set that is still being written to.
`;
}

main().catch((error: unknown) => {
  console.error('benchmark failed', error);
  process.exitCode = 1;
});
