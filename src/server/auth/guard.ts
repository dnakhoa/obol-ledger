import 'server-only';

import { currentViewer, type Viewer } from './viewer';

/** The only viewer shape that can be allowed to write. */
type Member = Extract<Viewer, { kind: 'member' }>;
import { servicesFor, type Services } from '@/server/container';

/**
 * The check every server action makes before it changes anything.
 *
 * Row-level security already stops one member writing to another tenant, and
 * it cannot stop a *guest* — a signed-out visitor reading the published demo
 * is reading a real tenant legitimately, and no policy can tell "reading the
 * demo" from "writing to the demo". That distinction is an application-level
 * fact, so it is checked in application code, once, here.
 *
 * Returning a discriminated result rather than throwing: an action turns this
 * into a message in the form the person is looking at, and an exception would
 * turn a predictable refusal into an error page.
 */

export type WriteContext =
  | { readonly allowed: true; readonly services: Services; readonly viewer: Member }
  | { readonly allowed: false; readonly reason: 'sign_in_required' | 'no_ledger' | 'read_only' };

export async function requireWriter(): Promise<WriteContext> {
  const viewer = await currentViewer();

  if (viewer.kind === 'guest') return { allowed: false, reason: 'sign_in_required' };
  if (viewer.kind === 'unenrolled') return { allowed: false, reason: 'no_ledger' };
  if (!viewer.canWrite) return { allowed: false, reason: 'read_only' };

  return { allowed: true, services: servicesFor(viewer.orgId), viewer };
}

/** What to tell someone whose write was refused, in their own terms. */
export function refusalMessage(reason: Exclude<WriteContext, { allowed: true }>['reason']): string {
  switch (reason) {
    case 'sign_in_required':
      return 'Sign in to keep your own books. This is the published demo, which anyone can read and nobody can change.';
    case 'no_ledger':
      return 'This account has no ledger yet. Create one to start posting entries.';
    case 'read_only':
      return 'Your role on this ledger is read-only.';
  }
}
