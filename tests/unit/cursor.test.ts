import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildPage, decodeCursor, encodeCursor } from '@/server/services/cursor';

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

describe('buildPage', () => {
  const rows = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) => ({
      id: `id-${offset + index}`,
      occurredAt: new Date(2026, 0, 1 + offset + index),
    }));
  const keyOf = (row: { id: string; occurredAt: Date }) => row;

  it('drops the over-fetched row and uses it only to detect another page', () => {
    // The query asks for limit + 1; the extra row is never shown. Its presence
    // is how we know a next page exists, without a COUNT over the whole table.
    const page = buildPage({
      rows: rows(4),
      limit: 3,
      direction: 'forward',
      hasCursor: false,
      keyOf,
    });

    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
  });

  it('reports no next page when the rows fit exactly', () => {
    const page = buildPage({
      rows: rows(3),
      limit: 3,
      direction: 'forward',
      hasCursor: false,
      keyOf,
    });
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('offers no previous page on the first page', () => {
    const page = buildPage({
      rows: rows(4),
      limit: 3,
      direction: 'forward',
      hasCursor: false,
      keyOf,
    });
    expect(page.previousCursor).toBeNull();
  });

  it('offers a previous page once the caller has moved off the first', () => {
    const page = buildPage({
      rows: rows(4),
      limit: 3,
      direction: 'forward',
      hasCursor: true,
      keyOf,
    });
    expect(decodeCursor(page.previousCursor ?? '')?.id).toBe('id-0');
  });

  it('reverses a backward page, because that query returns oldest first', () => {
    const page = buildPage({
      rows: rows(4),
      limit: 3,
      direction: 'backward',
      hasCursor: true,
      keyOf,
    });

    expect(page.items.map((row) => row.id)).toEqual(['id-2', 'id-1', 'id-0']);
    // Arrived from a later page, so one always exists in that direction.
    expect(decodeCursor(page.nextCursor ?? '')?.id).toBe('id-0');
    expect(decodeCursor(page.previousCursor ?? '')?.id).toBe('id-2');
  });

  it('reports no previous page when paging back reaches the newest row', () => {
    const page = buildPage({
      rows: rows(2),
      limit: 3,
      direction: 'backward',
      hasCursor: true,
      keyOf,
    });
    expect(page.items.map((row) => row.id)).toEqual(['id-1', 'id-0']);
    expect(page.previousCursor).toBeNull();
  });

  it('handles an empty result without inventing cursors', () => {
    const page = buildPage({ rows: [], limit: 3, direction: 'forward', hasCursor: true, keyOf });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.previousCursor).toBeNull();
  });
});
