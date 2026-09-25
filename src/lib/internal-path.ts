/**
 * Whether a redirect target stays on this site.
 *
 * `//evil.test` is another host, and so are `/\\evil.test` and a slash
 * followed by a tab or newline: browsers treat a backslash as a slash and
 * drop those characters before they parse the URL.
 */
export function isInternalPath(path: string): boolean {
  return /^\/(?![/\\])/u.test(path) && !/[\u0000-\u001f\\]/u.test(path);
}
