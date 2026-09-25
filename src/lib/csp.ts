/**
 * The Content-Security-Policy every page is served with.
 *
 * - Scripts: this request's nonce, and what those scripts load. Development
 *   adds `'unsafe-eval'`, which React's dev build needs for its stack traces.
 * - Styles: `'unsafe-inline'`, because components set widths and colours
 *   through `style=`. A style cannot run code; the risk it leaves is CSS used
 *   to leak text, which `img-src` and `connect-src` below bound.
 * - Images: this origin, plus the two places a sign-in avatar comes from.
 * - Connections and forms: this origin only, so an injected form or fetch
 *   cannot post the page's contents elsewhere. Sign-in leaves for the
 *   provider by navigation, which `form-action` does not govern.
 * - Framing: nobody, the same as `X-Frame-Options: DENY`.
 */
export function contentSecurityPolicy(nonce: string, development = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://*.googleusercontent.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
