import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/messages/en';

/**
 * Function-valued messages passed without being called.
 *
 * Most messages are strings, but some take a value — `asAt(date)`,
 * `overdue(percent)`. Calling one in a Server Component is fine: only the
 * finished string is ever sent. *Passing* one to a Client Component is not,
 * and React refuses it at runtime with "Functions cannot be passed directly
 * to Client Components".
 *
 * This exists because that shipped. `lineAccount` was a function, the transfer
 * page passed it to `EntryComposer`, and `/transfer` — a main nav item — threw
 * on every load in production. Nothing caught it: the types are identical
 * either side of the boundary, so `tsc` is happy, and the page still answers
 * 200 because the error surfaces after hydration, so an HTTP check that greps
 * the HTML for an error sees a healthy page.
 *
 * A message a Client Component must format is a template instead, filled with
 * `fill()` where the value is known.
 */

const ROOT = join(import.meta.dirname, '..', '..', 'src');

/** Every path through the message tree whose value is a function. */
function functionPaths(node: unknown, trail: readonly string[] = []): string[] {
  if (typeof node === 'function') return [trail.join('.')];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => functionPaths(value, [...trail, key]));
}

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/u.test(entry) ? [path] : [];
  });
}

describe('messages that are functions', () => {
  it('are never passed uncalled, which a Client Component cannot receive', () => {
    // Matched on the whole path, not the last segment. `caption` is a
    // function under `aging` and a plain string under `shipments`, so a
    // name-only check calls four innocent pages guilty and teaches whoever
    // reads the failure to distrust it.
    const paths = functionPaths(en);

    const offenders: string[] = [];
    for (const path of files(ROOT)) {
      // The dictionaries declare these; they are not call sites.
      if (path.includes(join('lib', 'i18n'))) continue;
      const source = readFileSync(path, 'utf8');

      for (const messagePath of paths) {
        // `t.namespace.name` not immediately followed by `(` is the function
        // itself rather than its result.
        const uncalled = new RegExp(String.raw`\bt\.${messagePath}\b(?!\s*\()`, 'gu');
        if (uncalled.test(source)) {
          offenders.push(`${relative(ROOT, path)}: t.${messagePath}`);
        }
      }
    }

    expect(
      offenders.sort(),
      '\nA message that is a function was passed without being called. A Client ' +
        'Component cannot receive it — make the message a template and use `fill()`, ' +
        'or call it before passing the result.\n',
    ).toEqual([]);
  });
});
