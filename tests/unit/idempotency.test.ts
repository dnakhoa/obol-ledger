import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalize, fingerprintOf } from '@/server/services/idempotency';

describe('canonicalize', () => {
  it('is insensitive to key order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('is sensitive to array order, which is meaningful', () => {
    // Posting order determines the sequence numbers of an entry, so two bodies
    // with the legs swapped are genuinely different requests.
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('recurses into nested objects', () => {
    expect(canonicalize({ outer: { b: 1, a: 2 } })).toBe(canonicalize({ outer: { a: 2, b: 1 } }));
  });

  it('ignores explicitly undefined properties, as JSON transport would', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it('distinguishes null from absent', () => {
    expect(canonicalize({ a: null })).not.toBe(canonicalize({}));
  });
});

describe('fingerprintOf', () => {
  it('is a stable 64-character hex digest', () => {
    expect(fingerprintOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
    expect(fingerprintOf({ a: 1 })).toBe(fingerprintOf({ a: 1 }));
  });

  it('agrees for any pair of objects that differ only in key order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (value) => {
        const shuffled = Object.fromEntries(Object.entries(value).reverse());
        expect(fingerprintOf(shuffled)).toBe(fingerprintOf(value));
      }),
    );
  });

  it('changes when any value changes', () => {
    expect(fingerprintOf({ amount: '25.00' })).not.toBe(fingerprintOf({ amount: '25.01' }));
  });
});
