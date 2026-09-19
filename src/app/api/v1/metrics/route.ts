import { defineRoute } from '@/server/http/route';
import { checkTenantIsolation } from '@/server/db/tenancy';
import { db } from '@/server/db/client';

/**
 * Prometheus exposition for the demo tenant.
 *
 * Text format rather than JSON because that is what a scraper speaks, and an
 * endpoint that needs a bespoke exporter in front of it does not get scraped.
 *
 * The metric worth alerting on is `obol_ledger_residual_minor`. Every posting
 * nets to zero, so the signed balances of every account must also net to zero.
 * Unlike latency or error rate, this gauge has exactly one acceptable value —
 * any drift means the cached balances have stopped agreeing with the postings
 * behind them, and every figure the system reports becomes untrustworthy.
 *
 *   - alert: LedgerOutOfBalance
 *     expr: obol_ledger_residual_minor != 0
 *     for: 1m
 *     severity: page
 */
export const GET = defineRoute({ name: 'metrics', rateLimit: false }, async ({ services }) => {
  const [metrics, isolation] = await Promise.all([
    services.reporting.metrics(),
    checkTenantIsolation(db()),
  ]);

  const lines: string[] = [];
  const gauge = (name: string, help: string, samples: [string, string | number][]) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const [labels, value] of samples) {
      lines.push(labels ? `${name}{${labels}} ${value}` : `${name} ${value}`);
    }
  };

  gauge(
    'obol_ledger_residual_minor',
    'Signed sum of all account balances. Always zero in a consistent ledger; anything else is a paging alert.',
    metrics.residualByCurrency.map((row) => [`currency="${row.currency}"`, row.residual]),
  );

  gauge(
    'obol_ledger_reserved_outflow_minor',
    'Funds reserved by pending entries and not yet settled.',
    metrics.reservedOutflow.map((row) => [`currency="${row.currency}"`, row.amount]),
  );

  gauge(
    'obol_ledger_entries',
    'Journal entries by lifecycle status.',
    metrics.entriesByStatus.map((row) => [`status="${row.status}"`, row.count]),
  );

  gauge('obol_ledger_accounts', 'Open ledger accounts.', [['', metrics.accounts]]);
  gauge('obol_ledger_postings', 'Individual postings written.', [['', metrics.postings]]);

  gauge(
    'obol_tenant_isolation_enforced',
    'Whether row-level security actually applies to the running connection. Zero means a privileged role is bypassing every policy.',
    [['', isolation.enforced ? 1 : 0]],
  );

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      // The Prometheus text format's own media type; a scraper checks it.
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
});
