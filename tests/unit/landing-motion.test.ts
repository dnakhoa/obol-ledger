import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  PACE,
  advance,
  opening,
  type Exchange,
  type TerminalState,
} from '@/components/landing/terminal-timeline';
import { MAX_TILT, MIN_TILT, commitReply, parseMinor, tilt } from '@/components/landing/balance';

const SCRIPT: readonly Exchange[] = [
  { statement: 'DELETE;', reply: [{ tone: 'error', text: 'ERROR' }] },
  { statement: 'UPDATE;', reply: [{ tone: 'error', text: 'ERROR' }] },
];

describe('the landing terminal', () => {
  it('opens on a finished exchange, so the page reads before any script runs', () => {
    expect(opening(SCRIPT)).toEqual({ exchange: 0, typed: 7, phase: 'replied' });
  });

  it('holds a reply long enough to read before typing the next statement', () => {
    expect(advance(opening(SCRIPT), SCRIPT)).toEqual({
      next: { exchange: 1, typed: 0, phase: 'typing' },
      after: PACE.read,
    });
  });

  it('types one keystroke at a time', () => {
    const typing: TerminalState = { exchange: 1, typed: 3, phase: 'typing' };
    expect(advance(typing, SCRIPT)).toEqual({
      next: { exchange: 1, typed: 4, phase: 'typing' },
      after: PACE.keystroke,
    });
  });

  it('pauses for Postgres to answer once the statement is complete', () => {
    const typed: TerminalState = { exchange: 1, typed: 7, phase: 'typing' };
    expect(advance(typed, SCRIPT)).toEqual({
      next: { exchange: 1, typed: 7, phase: 'replied' },
      after: PACE.think,
    });
  });

  it('starts over after the last exchange', () => {
    const last: TerminalState = { exchange: 1, typed: 7, phase: 'replied' };
    expect(advance(last, SCRIPT).next).toEqual({ exchange: 0, typed: 0, phase: 'typing' });
  });

  it('never types past a statement or reaches for an exchange that is not there', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), (steps) => {
        let state = opening(SCRIPT);
        for (let step = 0; step < steps; step += 1) {
          state = advance(state, SCRIPT).next;
          const exchange = SCRIPT[state.exchange];
          expect(exchange).toBeDefined();
          expect(state.typed).toBeGreaterThanOrEqual(0);
          expect(state.typed).toBeLessThanOrEqual(exchange?.statement.length ?? 0);
        }
      }),
    );
  });
});

describe('the balance check', () => {
  it.each([
    ['1000', 1000],
    ['1,000', 1000],
    ['  42 ', 42],
    ['', 0],
    ['abc', 0],
    ['-5', 5],
    // Capped, so a pasted phone number cannot become a float that loses units.
    ['12345678901234', 999_999_999],
  ])('reads %j as %s minor units', (text, expected) => {
    expect(parseMinor(text)).toBe(expected);
  });

  it('stays level when the sides agree', () => {
    expect(tilt(500, 500)).toBe(0);
  });

  it('dips toward the heavier side', () => {
    // SVG rotates clockwise for a positive angle, which lowers the right pan:
    // the credit side.
    expect(tilt(1000, 999)).toBeLessThan(0);
    expect(tilt(999, 1000)).toBeGreaterThan(0);
  });

  it('commits a balanced entry', () => {
    expect(commitReply(750, 750)).toEqual([{ tone: 'ok', text: 'COMMIT' }]);
  });

  it('quotes the trigger, with the size of the gap, for one that is not', () => {
    const reply = commitReply(1000, 997);
    expect(reply[0]?.text).toBe('ERROR:  23514 check_violation');
    expect(reply[1]?.text).toContain('is unbalanced by 3 minor units');
    expect(reply.at(-1)?.text).toBe('ROLLBACK');
  });

  it('tips visibly for a single unit, and never past the stops', () => {
    fc.assert(
      fc.property(fc.nat(10 ** 9), fc.nat(10 ** 9), (debit, credit) => {
        const angle = Math.abs(tilt(debit, credit));
        if (debit === credit) expect(angle).toBe(0);
        else {
          expect(angle).toBeGreaterThanOrEqual(MIN_TILT);
          expect(angle).toBeLessThanOrEqual(MAX_TILT);
        }
      }),
    );
  });
});
