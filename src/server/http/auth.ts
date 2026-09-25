import { authentication } from '@/server/container';
import { DemoUnavailableError, demoOrgId } from '@/server/auth/viewer';
import type { Principal } from '@/server/services/authentication';
import { problem, type Problem } from './problem';

/**
 * Who a request is acting as.
 *
 * Writes carry a bearer token, which resolves through the `api_keys` table to
 * exactly one tenant. Reads are public on this deployment and act as the demo
 * tenant — deliberately through the *same* path, so the published ledger is one
 * tenant of a real multi-tenant system rather than a single-tenant app with
 * tenancy bolted on the side.
 *
 * Either way the request ends up with an `orgId`, and every query it makes runs
 * under the row-level security policy keyed on it. There is no code path that
 * reaches the ledger without a tenant.
 */
export type Authenticated = { readonly orgId: string; readonly principal?: Principal };

export async function authenticate(
  request: Request,
  required: boolean,
): Promise<Authenticated | Problem> {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, presented] = header.split(' ');
  const bearer = scheme?.toLowerCase() === 'bearer' && presented ? presented : undefined;

  if (bearer) {
    const principal = await authentication().resolve(bearer);
    if (!principal) {
      return problem(
        401,
        'unauthorized',
        'Authentication required',
        'The bearer token is not valid, or has been revoked.',
      );
    }
    return { orgId: principal.orgId, principal };
  }

  if (required) {
    return problem(
      401,
      'unauthorized',
      'Authentication required',
      'Supply a bearer token: Authorization: Bearer <token>.',
    );
  }

  // By the flag the seed sets, never by slug: a slug is chosen by whoever
  // names a ledger, and matching on one is how a tenant becomes public.
  try {
    return { orgId: await demoOrgId() };
  } catch (error) {
    if (!(error instanceof DemoUnavailableError)) throw error;
    return problem(
      503,
      'not-configured',
      'Service not configured',
      'No organization is marked as the demo, so there is no ledger to read. Run pnpm db:seed.',
    );
  }
}
