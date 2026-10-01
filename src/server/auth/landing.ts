import type { Viewer } from './viewer';

/**
 * Where the landing page sends a visitor instead of pitching to them, if
 * anywhere.
 *
 * Only a member has books to go to. An anonymous session with no ledger yet
 * is somebody whose sample ledger failed to fill — a rate limit, a timeout —
 * and sending them to the dashboard would show them the read-only demo and,
 * because `/` would keep redirecting, never let them back to the button that
 * retries. The sign-in page is where that button lives for exactly this
 * case. A signed-in account with no ledger goes to create one.
 *
 * Pure, and apart from the page, so the rule is tested by handing it a
 * viewer rather than by signing in.
 */
export function landingRedirect(
  viewer: Viewer | null,
): '/overview' | '/sign-in' | '/onboarding' | null {
  if (viewer === null || viewer.kind === 'guest') return null;
  if (viewer.kind === 'member') return '/overview';
  return viewer.sample ? '/sign-in' : '/onboarding';
}
