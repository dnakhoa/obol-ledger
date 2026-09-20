import 'server-only';

import { headers } from 'next/headers';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { memberships, organizations } from '@/server/db/schema';
import { auth } from './config';

/**
 * Who is asking, and which ledger they get.
 *
 * Every page and every server action resolves through here, so the answer to
 * "whose books am I looking at?" is computed in one place from the session
 * rather than assembled per route.
 *
 * Two shapes, and the distinction is the whole authorisation model:
 *
 *  - A **guest** is anyone without a session. They read the published demo
 *    ledger and can change nothing. Before this existed the demo accepted
 *    writes from any visitor, which made it explorable and also made it
 *    impossible to keep real books in.
 *  - A **member** has a session and a membership row. They read and write
 *    their own organisation, and the row-level security policies that already
 *    exist do the enforcing — this only decides which `org_id` to set.
 *
 * A signed-in person with no membership is neither: they are mid-onboarding,
 * and every page sends them there rather than guessing an organisation for
 * them.
 */

export type Viewer =
  | { readonly kind: 'guest'; readonly orgId: string; readonly canWrite: false }
  | {
      readonly kind: 'member';
      readonly orgId: string;
      readonly canWrite: boolean;
      readonly userId: string;
      readonly name: string;
      readonly email: string;
      readonly image: string | null;
      readonly role: string;
    }
  | {
      readonly kind: 'unenrolled';
      readonly userId: string;
      readonly name: string;
      readonly email: string;
      readonly image: string | null;
    };

/** Roles that may write. A viewer reads; the other two do not. */
const WRITERS = new Set(['owner', 'member']);

export async function currentViewer(): Promise<Viewer> {
  // `next/headers` is the only way a Server Component can see the request,
  // and it throws outside one — which is why route handlers use
  // `viewerFor(request)` instead of reaching for the same magic.
  const session = await auth().api.getSession({ headers: await headers() });
  return resolveViewer(session?.user ?? undefined);
}

/** The same resolution for a route handler, which already holds the request. */
export async function viewerFor(request: Request): Promise<Viewer> {
  const session = await auth().api.getSession({ headers: request.headers });
  return resolveViewer(session?.user ?? undefined);
}

/**
 * The resolution itself, separated from where the session came from.
 *
 * `currentViewer` can only run inside a request, because `next/headers` says
 * so — which would make the authorisation model reachable only through a
 * rendered page. This half takes the authenticated user as an argument, so
 * the rules that matter are tested directly against a real database instead
 * of through a browser.
 */
export type AuthenticatedUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null | undefined;
};

export async function resolveViewer(user?: AuthenticatedUser): Promise<Viewer> {
  if (!user) {
    const demo = await demoOrgId();
    return { kind: 'guest', orgId: demo, canWrite: false };
  }
  const [membership] = await db()
    .select({ orgId: memberships.orgId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    // Oldest first, so a person with several organisations lands on the one
    // they created rather than on whichever the planner returned.
    .orderBy(asc(memberships.createdAt))
    .limit(1);

  if (!membership) {
    return {
      kind: 'unenrolled',
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
    };
  }

  return {
    kind: 'member',
    orgId: membership.orgId,
    canWrite: WRITERS.has(membership.role),
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: membership.role,
  };
}

/**
 * Whether this viewer may write to a particular organisation.
 *
 * Asked by every server action before it does anything. It is belt to the
 * policies' braces: row-level security already stops a member writing to
 * another tenant, and this stops a *guest* writing at all, which no policy
 * could express because a guest is reading a real tenant legitimately.
 */
export function canWriteTo(viewer: Viewer, orgId: string): boolean {
  return viewer.kind === 'member' && viewer.canWrite && viewer.orgId === orgId;
}

/**
 * The published demo tenant.
 *
 * Identified by a column, not by comparing a slug to an environment variable
 * — that is how a tenant becomes publicly readable by renaming itself.
 *
 * Deliberately not cached. It was, and the cache bought one indexed lookup of
 * a one-row table while costing a stale identity for the lifetime of the
 * process: re-seeding recreates the organisation with a new id, and every
 * signed-out request afterwards resolved to a tenant that no longer existed —
 * silently, because an id nobody can see returns an empty ledger rather than
 * an error.
 */
export async function demoOrgId(): Promise<string> {
  const [demo] = await db()
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.isDemo, true))
    .limit(1);

  if (!demo) {
    throw new DemoUnavailableError(
      'No organisation is marked as the demo, so there is nothing for a signed-out visitor to read.',
    );
  }

  return demo.id;
}

export class DemoUnavailableError extends Error {
  override readonly name = 'DemoUnavailableError';
}

/** The organisation's display name, for the shell's "whose books" line. */
export async function orgName(orgId: string): Promise<string> {
  const [row] = await db()
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row?.name ?? 'Ledger';
}

/** Membership lookup for a specific organisation, used when a route names one. */
export async function membershipIn(userId: string, orgId: string): Promise<string | undefined> {
  const [row] = await db()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  return row?.role;
}
