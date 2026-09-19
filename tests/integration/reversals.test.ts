import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import type { AccountDto, TransactionDto } from '@/server/services/dto';

/**
 * Reversing entries.
 *
 * The README, ADR 1 and the design rationale all say a mistake is corrected by
 * posting a reversing entry rather than by editing history. These are what make
 * that true rather than aspirational.
 */
describe('reversing entries', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: AccountDto;
  let revenue: AccountDto;
  let original: TransactionDto;

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    cash = await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
    revenue = await openAccount(db, db.$orgId, {
      name: 'Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });

    const posted = await services.journal.postEntry({
      description: 'Invoice 1042',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(50_000n) },
        { accountId: revenue.id, amount: usd(-50_000n) },
      ],
    });
    if (!posted.ok) throw new Error(`setup failed: ${posted.error.code}`);
    original = posted.value.transaction;
  });

  afterEach(async () => {
    await db.$close();
  });

  it('posts the mirror image and nets the balances to zero', async () => {
    const before = await services.accounts.byId(cash.id);
    expect(before.ok && before.value.balance.amount).toBe('500.00');

    const result = await services.journal.reverseEntry({ transactionId: original.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reversal = result.value.transaction;
    expect(reversal.reversesTransactionId).toBe(original.id);
    expect(reversal.description).toBe('Reversal of Invoice 1042');

    // Every amount negated: what was a debit is now a credit.
    expect(reversal.postings.map((p) => p.direction)).toEqual(['credit', 'debit']);
    expect(reversal.postings.map((p) => p.amount.amount)).toEqual(['500.00', '500.00']);

    const after = await services.accounts.byId(cash.id);
    expect(after.ok && after.value.balance.amount).toBe('0.00');
  });

  it('leaves the original on the record', async () => {
    await services.journal.reverseEntry({ transactionId: original.id });

    // Two entries, not zero. A reversal is a correction, not a deletion.
    const page = await services.journal.list({ limit: 10 });
    expect(page.items).toHaveLength(2);

    const reread = await services.journal.byId(original.id);
    expect(reread?.description).toBe('Invoice 1042');
  });

  it('marks the original as reversed, so "is this still in effect?" is answerable', async () => {
    const result = await services.journal.reverseEntry({ transactionId: original.id });
    if (!result.ok) return;

    const reread = await services.journal.byId(original.id);
    expect(reread?.reversedByTransactionId).toBe(result.value.transaction.id);
    expect(reread?.reversesTransactionId).toBeNull();

    // And the flag travels on list responses, not just single fetches.
    const page = await services.journal.list({ limit: 10 });
    const listed = page.items.find((item) => item.id === original.id);
    expect(listed?.reversedByTransactionId).toBe(result.value.transaction.id);
  });

  it('refuses to reverse the same entry twice', async () => {
    const first = await services.journal.reverseEntry({ transactionId: original.id });
    expect(first.ok).toBe(true);

    const second = await services.journal.reverseEntry({ transactionId: original.id });
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'already_reversed', transactionId: original.id },
    });

    // Still two entries: the refusal wrote nothing.
    expect((await services.journal.list({ limit: 10 })).items).toHaveLength(2);
  });

  it('reports a missing entry rather than throwing', async () => {
    const result = await services.journal.reverseEntry({ transactionId: 'txn_nope' });
    expect(result).toMatchObject({ ok: false, error: { code: 'entry_not_found' } });
  });

  it('accepts a custom description and date', async () => {
    const occurredAt = new Date('2026-03-01T09:00:00.000Z');
    const result = await services.journal.reverseEntry({
      transactionId: original.id,
      description: 'Invoice 1042 raised in error',
      occurredAt,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transaction.description).toBe('Invoice 1042 raised in error');
    expect(result.value.transaction.occurredAt).toBe(occurredAt.toISOString());
  });

  it('applies the overdraft rule to the reversal itself', async () => {
    // Reversing a deposit that has since been spent would overdraw the account.
    // The reversal is an ordinary entry, so it is refused like any other —
    // which is correct: the money has already moved on.
    const savings = await openAccount(db, db.$orgId, { name: 'Savings', type: 'asset' });
    const spend = await services.journal.postEntry({
      description: 'Moved to savings',
      currency: 'USD',
      postings: [
        { accountId: savings.id, amount: usd(50_000n) },
        { accountId: cash.id, amount: usd(-50_000n) },
      ],
    });
    expect(spend.ok).toBe(true);

    const result = await services.journal.reverseEntry({ transactionId: original.id });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'insufficient_funds', accountId: cash.id },
    });
  });

  it('allows a reversal to itself be reversed', async () => {
    // Legitimate: undoing a correction that was itself a mistake. The unique
    // index constrains one reversal *per entry*, not the depth of the chain.
    const first = await services.journal.reverseEntry({ transactionId: original.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await services.journal.reverseEntry({
      transactionId: first.value.transaction.id,
    });
    expect(second.ok).toBe(true);

    // Net effect is back to the original.
    const after = await services.accounts.byId(cash.id);
    expect(after.ok && after.value.balance.amount).toBe('500.00');
  });

  it('keeps the books balanced throughout', async () => {
    await services.journal.reverseEntry({ transactionId: original.id });
    const rows = await services.reporting.trialBalance();
    expect(rows.every((row) => row.balanced)).toBe(true);
  });
});
