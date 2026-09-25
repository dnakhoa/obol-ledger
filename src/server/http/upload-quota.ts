import { db } from '@/server/db/client';
import { durableRateLimit } from './durable-rate-limit';

/**
 * How often one ledger may send the server a file.
 *
 * Counted per organisation rather than per address, because a file is stored
 * against the organisation and a sample ledger costs nothing to get: a script
 * holding one session could otherwise fill the database four megabytes at a
 * time. The daily figure is far past what a business attaches in a day and
 * far short of what a loop sends.
 */
export async function uploadAllowed(
  orgId: string,
): Promise<
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number }
> {
  const minute = await durableRateLimit(db(), `upload:${orgId}`, { limit: 20 });
  if (!minute.allowed) return minute;
  const day = await durableRateLimit(db(), `upload-day:${orgId}`, {
    limit: 300,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!day.allowed) return day;
  return { allowed: true };
}
