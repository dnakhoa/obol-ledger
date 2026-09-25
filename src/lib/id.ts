/**
 * Prefixed, lexicographically sortable identifiers — `acct_01JBQ…`.
 *
 * A ULID (48-bit millisecond timestamp + 80 bits of randomness, Crockford
 * base32) is preferred over a UUIDv4 for two practical reasons: rows insert in
 * roughly ascending order, which keeps the primary-key B-tree from fragmenting,
 * and "most recent first" pagination can key off the id itself. The type prefix
 * makes a misrouted id (`acct_` passed where `txn_` was wanted) obvious in logs
 * and, via the branded types below, a compile error.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_BYTES = 10;
const TIMESTAMP_CHARS = 10;
const RANDOM_CHARS = 16;

function encodeTimestamp(milliseconds: number): string {
  let remaining = BigInt(milliseconds);
  let out = '';
  for (let i = 0; i < TIMESTAMP_CHARS; i += 1) {
    out = CROCKFORD[Number(remaining % 32n)] + out;
    remaining /= 32n;
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  for (let i = 0; i < RANDOM_CHARS; i += 1) {
    out = CROCKFORD[Number(value % 32n)] + out;
    value /= 32n;
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  const bytes = new Uint8Array(RANDOM_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return encodeTimestamp(now) + encodeRandom(bytes);
}

export const ID_PREFIXES = {
  account: 'acct',
  transaction: 'txn',
  posting: 'post',
  organization: 'org',
  apiKey: 'key',
  webhookEndpoint: 'whe',
  webhookDelivery: 'whd',
  event: 'evt',
  period: 'per',
  membership: 'mem',
  rate: 'rate',
  inventoryItem: 'item',
  costLayer: 'layer',
  inventoryMovement: 'move',
  layerConsumption: 'draw',
  shipment: 'ship',
  landedCharge: 'chrg',
  landedAllocation: 'alloc',
  taxCode: 'tax',
  taxEntry: 'txe',
  taxReturn: 'ret',
  taxReturnMonth: 'retm',
  sale: 'sale',
  creditNote: 'cn',
  creditNoteLine: 'cnl',
  layerRestoration: 'rest',
  supplierReturn: 'sret',
} as const;

export type EntityKind = keyof typeof ID_PREFIXES;

declare const idBrand: unique symbol;

/** `AccountId` and `TransactionId` are distinct types despite both being strings. */
export type Id<K extends EntityKind> = string & { readonly [idBrand]: K };

export type OrganizationId = Id<'organization'>;
export type AccountId = Id<'account'>;
export type TransactionId = Id<'transaction'>;
export type PostingId = Id<'posting'>;

export function newId<K extends EntityKind>(kind: K, now?: number): Id<K> {
  return `${ID_PREFIXES[kind]}_${ulid(now)}` as Id<K>;
}

const ULID_BODY = `[${CROCKFORD}]{${TIMESTAMP_CHARS + RANDOM_CHARS}}`;

export function idPattern(kind: EntityKind): RegExp {
  return new RegExp(`^${ID_PREFIXES[kind]}_${ULID_BODY}$`, 'u');
}

export function isId<K extends EntityKind>(kind: K, value: string): value is Id<K> {
  return idPattern(kind).test(value);
}

/**
 * Re-brands a string that came back from the database. The row was written
 * through `newId`, so the shape is already guaranteed; this documents the
 * crossing of the trust boundary rather than re-validating on every read.
 */
export function unsafeId<K extends EntityKind>(_kind: K, value: string): Id<K> {
  return value as Id<K>;
}
