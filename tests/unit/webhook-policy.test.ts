import { describe, expect, it } from 'vitest';
import { backoffMs, isRetryable, MAX_ATTEMPTS, subscribes } from '@/server/domain/webhook';

describe('retry policy', () => {
  it('grows the window exponentially', () => {
    // Asserted at the top of the jitter range, which is the schedule itself.
    const ceiling = (attempt: number) => backoffMs(attempt, () => 1);
    expect(ceiling(1)).toBe(10_000);
    expect(ceiling(2)).toBe(40_000);
    expect(ceiling(3)).toBe(160_000);
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(ceiling(attempt + 1)).toBeGreaterThanOrEqual(ceiling(attempt));
    }
  });

  it('caps the wait at six hours', () => {
    expect(backoffMs(MAX_ATTEMPTS, () => 1)).toBe(6 * 60 * 60 * 1000);
    expect(backoffMs(100, () => 1)).toBe(6 * 60 * 60 * 1000);
  });

  it('spreads retries across the whole window', () => {
    // Full jitter, not a fixed schedule. Deliveries are created in bursts —
    // one entry fans out to every endpoint at once — so a deterministic delay
    // would retry them in a synchronised wave straight back at a subscriber
    // that is still recovering.
    expect(backoffMs(3, () => 0)).toBe(0);
    expect(backoffMs(3, () => 0.5)).toBe(80_000);
    expect(backoffMs(3, () => 1)).toBe(160_000);
  });

  it('retries what a subscriber might recover from, and nothing else', () => {
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    // "Not now" codes: the subscriber is asking to be asked again.
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(408)).toBe(true);
    expect(isRetryable(425)).toBe(true);
    // A 404 endpoint will still be a 404 in six hours.
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
  });
});

describe('subscriptions', () => {
  it('treats an empty list as every event', () => {
    // Missing an event is worse than receiving one you ignore, so the default
    // for a subscriber that has not chosen is everything.
    expect(subscribes([], 'entry.posted')).toBe(true);
  });

  it('filters to the chosen types', () => {
    expect(subscribes(['account.opened'], 'entry.posted')).toBe(false);
    expect(subscribes(['account.opened'], 'account.opened')).toBe(true);
  });
});
