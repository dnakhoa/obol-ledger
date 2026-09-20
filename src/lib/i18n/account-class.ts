import type { Messages } from './messages/en';

/**
 * The five account classes, named and explained in the reader's language.
 *
 * Shared because the overview and the chart of accounts both group by class
 * and would otherwise disagree about what to call them — and because
 * `buildPosition` labels the classes for the API, where a language preference
 * has no business existing.
 */
export function classLabel(type: string, t: Messages): string {
  switch (type) {
    case 'asset':
      return t.accounts.asset;
    case 'liability':
      return t.accounts.liability;
    case 'equity':
      return t.accounts.equity;
    case 'revenue':
      return t.accounts.revenue;
    case 'expense':
      return t.accounts.expense;
    default:
      return type;
  }
}

export function classBlurb(type: string, t: Messages): string {
  switch (type) {
    case 'asset':
      return t.accounts.assetBlurb;
    case 'liability':
      return t.accounts.liabilityBlurb;
    case 'equity':
      return t.accounts.equityBlurb;
    case 'revenue':
      return t.accounts.revenueBlurb;
    case 'expense':
      return t.accounts.expenseBlurb;
    default:
      return '';
  }
}
