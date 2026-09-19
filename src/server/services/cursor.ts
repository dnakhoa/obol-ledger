/**
 * Opaque keyset cursors over `(occurredAt, id)`.
 *
 * Ordering by id alone would order the journal by *recording* time, which is
 * not what a reader of a ledger expects: a back-dated entry recorded today
 * belongs with its own date. Ordering by `occurredAt` alone is not stable
 * either, because two entries can share a timestamp — so the id breaks the tie
 * and the pair becomes a unique, totally ordered key that Postgres can seek on
 * with a single row-wise comparison against the matching index.
 *
 * The cursor is base64url of `<iso>|<id>`: opaque enough that no client starts
 * constructing them by hand, and readable enough to debug. It is not a security
 * boundary — it encodes only data the caller already has.
 */
export type Keyset = { readonly occurredAt: Date; readonly id: string };

export function encodeCursor(keyset: Keyset): string {
  return Buffer.from(`${keyset.occurredAt.toISOString()}|${keyset.id}`, 'utf8').toString(
    'base64url',
  );
}

/**
 * Returns `undefined` for anything malformed rather than throwing.
 *
 * A cursor arrives from a URL, so it is attacker-controlled. Treating a broken
 * one as "start from the beginning" is a harmless first page; throwing would
 * turn a stale bookmark into a 500.
 */
export function decodeCursor(cursor: string): Keyset | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator < 1) return undefined;

    const occurredAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(occurredAt.getTime()) || id.length === 0) return undefined;

    return { occurredAt, id };
  } catch {
    return undefined;
  }
}

export type PageDirection = 'forward' | 'backward';

/**
 * Turns an over-fetched row set into a page with cursors for both directions.
 *
 * A keyset cursor is *directional*: it names a row, and the query says whether
 * to look at what comes before or after it. "Previous" therefore cannot be
 * derived from a forward cursor — it needs its own query (`> cursor`, ascending),
 * whose results come back oldest-first and have to be reversed to be displayed.
 *
 * Both queries fetch `limit + 1` rows. The extra row is never shown; its
 * presence is simply how we know another page exists, which is cheaper and more
 * accurate than a separate `COUNT(*)` over the whole table.
 */
export function buildPage<T>(options: {
  readonly rows: readonly T[];
  readonly limit: number;
  readonly direction: PageDirection;
  /** Whether the caller arrived here from a cursor, i.e. is not on page one. */
  readonly hasCursor: boolean;
  readonly keyOf: (row: T) => Keyset;
}): { items: T[]; nextCursor: string | null; previousCursor: string | null } {
  const { rows, limit, direction, hasCursor, keyOf } = options;
  const overflowed = rows.length > limit;
  const trimmed = rows.slice(0, limit);

  // The backward query returns rows oldest-first; the page is always displayed
  // newest-first, so it is reversed here rather than by every caller.
  const items = direction === 'backward' ? [...trimmed].reverse() : trimmed;

  const first = items[0];
  const last = items.at(-1);

  if (direction === 'backward') {
    return {
      items,
      // We got here from a later page, so one always exists in that direction.
      nextCursor: last ? encodeCursor(keyOf(last)) : null,
      previousCursor: overflowed && first ? encodeCursor(keyOf(first)) : null,
    };
  }

  return {
    items,
    nextCursor: overflowed && last ? encodeCursor(keyOf(last)) : null,
    previousCursor: hasCursor && first ? encodeCursor(keyOf(first)) : null,
  };
}
