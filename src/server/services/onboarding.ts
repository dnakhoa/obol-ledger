import 'server-only';

import { eq } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/money';
import type { Locale } from '@/lib/i18n';
import { memberships, organizations } from '@/server/db/schema';
import { db } from '@/server/db/client';
import type { Transactional } from '@/server/db/types';
import { createAccountService } from './accounts';
import { populateSampleLedger } from './sample-ledger';
import {
  CHART_TEMPLATE_DEFINITIONS,
  CHART_TEMPLATES,
  type ChartTemplate,
} from '@/server/domain/chart';

/**
 * Creating a ledger for a person who has just signed in.
 *
 * The functional currency is asked for here and nowhere else, because it is
 * the one setting that cannot be changed later without restating every entry
 * ever posted: it is the unit the balance rule is asserted in. Asking once, up
 * front, is better than offering a settings toggle that would have to refuse.
 */

export type CreateLedgerInput = {
  readonly userId: string;
  readonly name: string;
  readonly functionalCurrency: CurrencyCode;
  /** Which chart of accounts to open with. Defaults to the generic one. */
  readonly chartTemplate?: ChartTemplate;
  /**
   * The language the books will be kept in.
   *
   * Asked here because it is a property of the accounting records rather than
   * a preference — the descriptions the ledger writes for itself become part
   * of the books and cannot be retranslated later without rewriting history.
   * Defaulting it to whatever language the person is reading the sign-up page
   * in is the best guess available, and it is the only moment at which the
   * guess is free to be wrong.
   */
  readonly locale?: Locale;
  /**
   * Open the template's starter accounts. False when the caller brings its own
   * chart, as the sample ledger does — two sets of the same codes would be
   * refused by the unique index, rightly.
   */
  readonly openChart?: boolean;
};

export async function createLedger(input: CreateLedgerInput): Promise<{ orgId: string }> {
  const orgId = newId('organization');
  const database = db();
  const template = CHART_TEMPLATE_DEFINITIONS[input.chartTemplate ?? 'generic'];

  // The organisation and the membership are written together: an organisation
  // nobody belongs to is invisible to every query in the application, and a
  // membership pointing at nothing is a foreign key violation. Neither half
  // is useful alone.
  await database.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: orgId,
      name: input.name,
      // Resolved from the transaction handle, not the pool: a query on the
      // pool from inside a transaction waits on locks that transaction holds,
      // which on a single connection is an immediate deadlock.
      slug: await uniqueSlug(tx, input.name, orgId),
      functionalCurrency: input.functionalCurrency,
      chartTemplate: template.id,
      locale: input.locale ?? 'en',
    });

    await tx.insert(memberships).values({
      id: newId('membership'),
      userId: input.userId,
      orgId,
      role: 'owner',
    });
  });

  // Opened through the ordinary account service, so the starter chart obeys
  // the same rules as anything a person opens by hand — the one-per-tenant
  // role indexes, and on a statutory chart the constraint that the leading
  // digit agrees with the type. A template that got a code wrong would be
  // rejected here rather than shipped.
  if (input.openChart === false) return { orgId };
  const accounts = createAccountService(database, orgId);
  for (const account of template.accounts) {
    await accounts.create({
      name: account.name,
      code: account.code,
      type: account.type,
      currency: input.functionalCurrency,
      overdraftAllowed: account.overdraft ?? false,
      ...(account.monetary === undefined ? {} : { monetary: account.monetary }),
      ...(account.role ? { role: account.role } : {}),
    });
  }

  return { orgId };
}

/**
 * A ledger of the visitor's own, filled with the sample company's quarter.
 *
 * The same books the read-only demo shows, but theirs: they can raise an
 * invoice, credit it, close a month, and see what the ledger refuses. Kept in
 * dong on Thông tư 200 because that is what the sample company is, whatever
 * language the visitor reads — only the name says it is a sample.
 */
export async function createSampleLedger(input: {
  readonly userId: string;
  readonly name: string;
}): Promise<{ orgId: string }> {
  const { orgId } = await createLedger({
    userId: input.userId,
    name: input.name,
    functionalCurrency: 'VND',
    chartTemplate: 'vn_tt200',
    locale: 'vi',
    openChart: false,
  });
  await populateSampleLedger(db(), orgId);
  return { orgId };
}

export function supportedCurrencies(): readonly CurrencyCode[] {
  return SUPPORTED_CURRENCIES;
}

export function chartTemplates(): readonly ChartTemplate[] {
  return CHART_TEMPLATES;
}

/**
 * A readable slug, made unique without a retry loop.
 *
 * The organisation id is already unique, so a suffix taken from it cannot
 * collide — which avoids the select-then-insert race that a "check if taken"
 * version loses under two simultaneous sign-ups.
 */
async function uniqueSlug(tx: Transactional, name: string, orgId: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-+|-+$/gu, '')
      .slice(0, 32) || 'ledger';

  const [taken] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, base))
    .limit(1);

  return taken ? `${base}-${orgId.slice(-6).toLowerCase()}` : base;
}
