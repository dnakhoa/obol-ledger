import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minorUnits } from '@/lib/money';
import { transferDraft, validateDraft } from '@/server/domain/transaction';

const posting = (accountId: string, amount: bigint) => ({
  accountId,
  amount: minorUnits(amount),
});

describe('validateDraft', () => {
  it('accepts a balanced two-sided entry', () => {
    const result = validateDraft({
      currency: 'USD',
      postings: [posting('a', 100n), posting('b', -100n)],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a balanced entry with many legs', () => {
    const result = validateDraft({
      currency: 'USD',
      postings: [posting('a', 100n), posting('b', -30n), posting('c', -70n)],
    });
    expect(result.ok).toBe(true);
  });

  it('reports the residual in the transaction currency', () => {
    const result = validateDraft({
      currency: 'JPY',
      postings: [posting('a', 100n), posting('b', -99n)],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unbalanced_transaction', residual: '1', currency: 'JPY' },
    });
  });

  it('rejects a zero-amount posting, which records nothing', () => {
    const result = validateDraft({
      currency: 'USD',
      postings: [posting('a', 0n), posting('b', 0n)],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'zero_amount_posting', index: 0 } });
  });

  it('rejects the same account appearing twice', () => {
    const result = validateDraft({
      currency: 'USD',
      postings: [posting('a', 100n), posting('a', -100n)],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'duplicate_account_in_transaction', accountId: 'a' },
    });
  });
});

describe('validateDraft laws', () => {
  /** Distinct accounts and non-zero amounts, with a final balancing leg. */
  const balancedEntry = fc
    .array(
      fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }).filter((n) => n !== 0n),
      {
        minLength: 1,
        maxLength: 8,
      },
    )
    .map((amounts) => {
      const residual = amounts.reduce((total, amount) => total + amount, 0n);
      return [...amounts, -residual];
    })
    .filter((amounts) => amounts.every((amount) => amount !== 0n));

  it('accepts every entry whose legs sum to zero', () => {
    fc.assert(
      fc.property(balancedEntry, (amounts) => {
        const result = validateDraft({
          currency: 'USD',
          postings: amounts.map((amount, index) => posting(`acct_${index}`, amount)),
        });
        expect(result.ok).toBe(true);
      }),
    );
  });

  it('rejects every entry perturbed by a non-zero amount', () => {
    fc.assert(
      fc.property(
        balancedEntry,
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (amounts, perturbation) => {
          const perturbed = [...amounts];
          perturbed[0] = (perturbed[0] ?? 0n) + perturbation;
          const result = validateDraft({
            currency: 'USD',
            postings: perturbed.map((amount, index) => posting(`acct_${index}`, amount)),
          });
          expect(result.ok).toBe(false);
        },
      ),
    );
  });

  it('is order-independent', () => {
    fc.assert(
      fc.property(balancedEntry, (amounts) => {
        const postings = amounts.map((amount, index) => posting(`acct_${index}`, amount));
        const forwards = validateDraft({ currency: 'USD', postings });
        const backwards = validateDraft({ currency: 'USD', postings: [...postings].reverse() });
        expect(forwards.ok).toBe(backwards.ok);
      }),
    );
  });
});

describe('transferDraft', () => {
  it('debits the destination and credits the source', () => {
    const result = transferDraft({
      fromAccountId: 'from',
      toAccountId: 'to',
      amount: minorUnits(2_500n),
      currency: 'USD',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.postings).toEqual([
      { accountId: 'to', amount: 2_500n },
      { accountId: 'from', amount: -2_500n },
    ]);
  });

  it('refuses a transfer from an account to itself', () => {
    const result = transferDraft({
      fromAccountId: 'same',
      toAccountId: 'same',
      amount: minorUnits(100n),
      currency: 'USD',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'duplicate_account_in_transaction' },
    });
  });

  it('refuses a zero transfer', () => {
    const result = transferDraft({
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: minorUnits(0n),
      currency: 'USD',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'zero_amount_posting' } });
  });
});
