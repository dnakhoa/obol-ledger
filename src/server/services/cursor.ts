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
