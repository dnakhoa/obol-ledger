import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from '@/lib/csp';

/**
 * A fresh script nonce for every page.
 *
 * The policy allows a script only if it carries this request's nonce, or was
 * loaded by one that did (`'strict-dynamic'`). Next reads the nonce from the
 * request's own policy header and stamps it on the scripts it emits; the
 * layout stamps it on the one inline script this app writes. An injected
 * `<script>` — the thing a stored XSS is — has no nonce and does not run,
 * which a policy that allowed `'unsafe-inline'` could not promise.
 *
 * Every page is rendered per request already (the layout reads the locale
 * cookie), so a per-request nonce costs no caching.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. The API answers JSON, static files carry no script, and
      // the document routes set their own, stricter policy.
      source: '/((?!api/|_next/static|_next/image|favicon|icon|apple-icon|files/|einvoices/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
