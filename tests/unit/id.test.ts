import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { idPattern, isId, newId, ulid } from '@/lib/id';

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
  });

  it('sorts lexicographically in timestamp order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 40 }),
        fc.integer({ min: 1, max: 10 ** 6 }),
        (base, gap) => {
          // Two ids minted a measurable interval apart must compare in that order,
          // which is what lets "ORDER BY id DESC" stand in for "newest first".
          expect(ulid(base) < ulid(base + gap)).toBe(true);
        },
      ),
    );
  });

  it('is overwhelmingly unlikely to collide within a millisecond', () => {
    const now = Date.now();
    const ids = new Set(Array.from({ length: 2_000 }, () => ulid(now)));
    expect(ids.size).toBe(2_000);
  });
});

describe('prefixed ids', () => {
  it('tags each entity kind', () => {
    expect(newId('account')).toMatch(idPattern('account'));
    expect(newId('transaction')).toMatch(idPattern('transaction'));
    expect(newId('posting')).toMatch(idPattern('posting'));
  });

  it('does not accept an id of the wrong kind', () => {
    const account = newId('account');
    expect(isId('account', account)).toBe(true);
    expect(isId('transaction', account)).toBe(false);
  });

  it('rejects ids that merely start with the right prefix', () => {
    expect(isId('account', 'acct_')).toBe(false);
    expect(isId('account', 'acct_short')).toBe(false);
    // Crockford base32 excludes I, L, O and U to avoid transcription errors.
    expect(isId('account', `acct_${'I'.repeat(26)}`)).toBe(false);
  });
});
