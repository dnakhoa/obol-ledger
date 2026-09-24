import { describe, expect, it } from 'vitest';
import { invoiceTotals } from '@/lib/invoice';
import { fromNet } from '@/server/domain/tax';

describe('the running total on an invoice being typed', () => {
  it('adds the lines and the tax in the invoice currency', () => {
    expect(invoiceTotals(['180000000', '270000000', '16000000'], 'VND', 1000)).toEqual({
      net: 466_000_000n,
      tax: 46_600_000n,
      gross: 512_600_000n,
    });
  });

  it('rounds the tax exactly as the ledger will when it posts', () => {
    // 0.05 × 8.25% is 0.004125 — the preview must land where fromNet does.
    const preview = invoiceTotals(['0.05'], 'USD', 825);
    expect(preview?.tax).toBe(fromNet(5n, 825).tax);
    const odd = invoiceTotals(['1234.57', '0.01'], 'USD', 1000);
    expect(odd?.tax).toBe(fromNet(123_458n, 1000).tax);
  });

  it('skips a line not yet filled in', () => {
    expect(invoiceTotals(['12000.00', ''], 'USD', 0)?.gross).toBe(1_200_000n);
  });

  it('shows no total rather than one that leaves a line out', () => {
    expect(invoiceTotals(['12000.00', 'twelve'], 'USD', 0)).toBeNull();
    // A fraction of a dong cannot be invoiced.
    expect(invoiceTotals(['100.5'], 'VND', 0)).toBeNull();
  });
});
