import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeCursor, encodeCursor } from '@/server/services/cursor';

describe('keyset cursors', () => {
  it('round-trips a keyset', () => {
    const keyset = { occurredAt: new Date('2026-09-19T10:30:00.000Z'), id: 'txn_abc' };
    const decoded = decodeCursor(encodeCursor(keyset));
    expect(decoded?.id).toBe('txn_abc');
    expect(decoded?.occurredAt.toISOString()).toBe('2026-09-19T10:30:00.000Z');
  });

  it('round-trips any timestamp and id', () => {
    fc.assert(
      fc.property(fc.date({ noInvalidDate: true }), fc.string({ minLength: 1 }), (date, id) => {
        const decoded = decodeCursor(encodeCursor({ occurredAt: date, id }));
        expect(decoded?.id).toBe(id);
        expect(decoded?.occurredAt.getTime()).toBe(date.getTime());
      }),
    );
  });

  it('produces a URL-safe token', () => {
    const cursor = encodeCursor({ occurredAt: new Date(), id: 'txn_01JBQZ8Q2N7K3F5M9R1T4V6X8Z' });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  it('stays within the length the query schema accepts', () => {
    const cursor = encodeCursor({ occurredAt: new Date(), id: 'txn_01JBQZ8Q2N7K3F5M9R1T4V6X8Z' });
    expect(cursor.length).toBeLessThanOrEqual(256);
  });

  it('treats a malformed cursor as "start from the beginning"', () => {
    // Cursors come from URLs, so they are attacker-controlled. A stale bookmark
    // should render page one, not a 500.
    for (const bad of ['', 'not-base64!!', 'Zm9v', Buffer.from('|').toString('base64url')]) {
      expect(decodeCursor(bad)).toBeUndefined();
    }
  });

  it('rejects a cursor whose timestamp is not a date', () => {
    expect(decodeCursor(Buffer.from('never|txn_x').toString('base64url'))).toBeUndefined();
  });
});
