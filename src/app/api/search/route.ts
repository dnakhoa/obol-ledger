import { NextResponse } from 'next/server';
import { servicesFor } from '@/server/container';
import { viewerFor } from '@/server/auth/viewer';
import { SetupRequiredError } from '@/server/setup-error';
import { rateLimit } from '@/server/http/rate-limit';

/**
 * Search behind the command palette.
 *
 * Deliberately outside `/api/v1`. The versioned surface is a contract: every
 * route there is in the OpenAPI document, and a test enforces it. This one
 * exists to populate one widget — its shape will change whenever that widget
 * does, and promising stability for it would be a lie a client could act on.
 *
 * `?q=` is matched against account names, entry descriptions and metadata
 * values at once, because the person typing does not know which of the three
 * their reference lives in — that is the whole point of a single box.
 */
export const dynamic = 'force-dynamic';

const MAX_PER_KIND = 6;

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) return NextResponse.json({ accounts: [], entries: [] });

  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  // A search box fires on every keystroke, so the quota is generous where the
  // write endpoints' is not.
  const decision = rateLimit(`search:${client}`, Date.now(), 300);
  if (!decision.allowed) {
    return NextResponse.json(
      { accounts: [], entries: [] },
      { status: 429, headers: { 'retry-after': String(decision.retryAfterSeconds) } },
    );
  }

  try {
    // Resolved from this request rather than from `next/headers`, which is
    // Server-Component-only and throws anywhere else.
    const viewer = await viewerFor(request);
    if (viewer.kind === 'unenrolled') return NextResponse.json({ accounts: [], entries: [] });
    const services = servicesFor(viewer.orgId);
    const needle = query.toLowerCase();

    // Accounts are filtered in memory: a chart of accounts is dozens of rows,
    // and a round trip to Postgres to scan dozens of rows on every keystroke
    // is slower than the round trip it saves.
    const [accounts, entries] = await Promise.all([
      services.accounts.list(),
      services.journal.list({ limit: MAX_PER_KIND, search: query }),
    ]);

    return NextResponse.json(
      {
        accounts: accounts
          .filter((account) => account.name.toLowerCase().includes(needle))
          .slice(0, MAX_PER_KIND)
          .map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type,
            balance: account.balance.amount,
            currency: account.balance.currency,
          })),
        entries: entries.items.map((entry) => ({
          id: entry.id,
          description: entry.description,
          occurredAt: entry.occurredAt,
          status: entry.status,
        })),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof SetupRequiredError) {
      return NextResponse.json({ accounts: [], entries: [] });
    }
    throw error;
  }
}
