import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minorUnits } from '@/lib/money';
import {
  ACCOUNT_TYPES,
  isTrialBalanced,
  normalBalanceOf,
  presentedBalance,
  signedFromPresented,
  type AccountType,
} from '@/server/domain/account';

const accountTypeArb = fc.constantFrom<AccountType>(...ACCOUNT_TYPES);

describe('normal balances', () => {
  it('matches the accounting convention', () => {
    expect(normalBalanceOf('asset')).toBe('debit');
    expect(normalBalanceOf('expense')).toBe('debit');
    expect(normalBalanceOf('liability')).toBe('credit');
    expect(normalBalanceOf('equity')).toBe('credit');
    expect(normalBalanceOf('revenue')).toBe('credit');
  });

  it('leaves debit-normal balances alone and flips credit-normal ones', () => {
    // Cash holding 100 reads as +100; revenue earned of 100 is stored as -100
    // in debit-positive space and must also read as +100.
    expect(presentedBalance(minorUnits(10_000n), 'asset')).toBe(10_000n);
    expect(presentedBalance(minorUnits(-10_000n), 'revenue')).toBe(10_000n);
  });

  it('round-trips through presentation for every account type', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        accountTypeArb,
        (amount, type) => {
          const stored = minorUnits(amount);
          expect(signedFromPresented(presentedBalance(stored, type), type)).toBe(amount);
        },
      ),
    );
  });
});

describe('trial balance', () => {
  it('holds for an empty ledger', () => {
    expect(isTrialBalanced([])).toBe(true);
  });

  it('holds whenever signed balances cancel out', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n })), (balances) => {
        const residual = balances.reduce((total, balance) => total + balance, 0n);
        expect(isTrialBalanced([...balances, -residual].map(minorUnits))).toBe(true);
      }),
    );
  });

  it('fails as soon as one unit goes missing', () => {
    expect(isTrialBalanced([minorUnits(100n), minorUnits(-99n)])).toBe(false);
  });
});
