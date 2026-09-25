import { describe, expect, it } from 'vitest';
import { STATUTORY_FORMS, fillForm, formsFor } from '@/server/domain/statutory';

const figure = (code: string, balance: bigint) => ({
  accountId: `acct_${code}`,
  code,
  name: code,
  balance,
});

const amount = (filled: ReturnType<typeof fillForm>, code: string) =>
  filled.lines.find((line) => line.code === code)?.amount;

describe('Mẫu B01-DN', () => {
  const form = STATUTORY_FORMS['B01-DN'];

  it('splits a customer ledger by the side each balance is on', () => {
    const filled = fillForm(form, [
      figure('1311', 500n), // owes us
      figure('1312', -120n), // paid in advance
      figure('3311', -300n), // we owe
      figure('3312', 40n), // we paid in advance
    ]);
    expect(amount(filled, '131')).toBe(500n);
    expect(amount(filled, '312')).toBe(120n);
    expect(amount(filled, '311')).toBe(300n);
    expect(amount(filled, '132')).toBe(40n);
  });

  it('prints depreciation as a negative beside its asset, and balances with the year’s result', () => {
    const filled = fillForm(
      form,
      [
        figure('1121', 1_000n),
        figure('211', 5_000n),
        figure('2141', -1_200n),
        figure('4111', -4_000n),
        figure('421', -300n),
      ],
      500n, // unclosed profit this year
    );
    expect(amount(filled, '223')).toBe(-1_200n);
    expect(amount(filled, '221')).toBe(3_800n);
    expect(amount(filled, '270')).toBe(4_800n);
    expect(amount(filled, '421')).toBe(800n);
    expect(amount(filled, '440')).toBe(4_800n);
    expect(filled.balanced).toBe(true);
  });

  it('reports an account no line claims instead of dropping it', () => {
    const filled = fillForm(form, [figure('1121', 10n), figure('999', -10n)]);
    expect(filled.unplaced.map((account) => account.code)).toEqual(['999']);
    expect(filled.balanced).toBe(false);
  });
});

describe('Mẫu B02-DN and B02-DNN', () => {
  it('derives net revenue, gross profit and profit after tax from movements', () => {
    const movements = [
      figure('511', -10_000n),
      figure('5212', 400n),
      figure('632', 6_000n),
      figure('515', -50n),
      figure('635', 150n),
      figure('641', 900n),
      figure('642', 1_100n),
      figure('711', -20n),
      figure('811', 70n),
      figure('8211', 285n),
    ];
    const filled = fillForm(STATUTORY_FORMS['B02-DN'], movements);
    expect(amount(filled, '10')).toBe(9_600n);
    expect(amount(filled, '20')).toBe(3_600n);
    expect(amount(filled, '30')).toBe(1_500n);
    expect(amount(filled, '50')).toBe(1_450n);
    expect(amount(filled, '60')).toBe(1_165n);
  });

  it('puts both halves of 642 on the one Thông tư 133 line', () => {
    const filled = fillForm(STATUTORY_FORMS['B02-DNN'], [
      figure('511', -1_000n),
      figure('6421', 100n),
      figure('6422', 200n),
    ]);
    expect(amount(filled, '24')).toBe(300n);
    expect(amount(filled, '60')).toBe(700n);
  });
});

describe('formsFor', () => {
  it('picks the forms of the circular the chart follows', () => {
    expect(formsFor('vn_tt200')).toEqual({ balanceSheet: 'B01-DN', incomeStatement: 'B02-DN' });
    expect(formsFor('vn_tt133')).toEqual({
      balanceSheet: 'B01a-DNN',
      incomeStatement: 'B02-DNN',
    });
    expect(formsFor('au_nz')).toBeNull();
  });
});
