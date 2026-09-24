import 'server-only';

import { currentViewer, type Viewer } from './viewer';
import { messagesFor, type Locale } from '@/lib/i18n';
import { viewerLocale } from '@/server/i18n';

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

/**
 * What to tell someone whose write was refused, in their own terms — and in
 * their own language.
 *
 * The sign-in sentence is the one a visitor to the public demo meets first,
 * the moment they press anything, so it was the worst possible place to be
 * the last English sentence on a Vietnamese page. The locale is looked up
 * here rather than passed in, because every caller wants the viewer's; the
 * deliberately English surfaces (webhooks, settings — see ADR 14) pass `en`.
 */
export async function refusalMessage(
  reason: Exclude<WriteContext, { allowed: true }>['reason'],
  locale?: Locale,
): Promise<string> {
  const t = messagesFor(locale ?? (await viewerLocale()));
  switch (reason) {
    case 'sign_in_required':
      return t.common.refusalSignIn;
    case 'no_ledger':
      return t.common.refusalNoLedger;
    case 'read_only':
      return t.common.refusalReadOnly;
  }
}
