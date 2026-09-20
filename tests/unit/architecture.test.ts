import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The layering, enforced rather than agreed.
 *
 * This project's argument is that a rule nothing checks is a rule that holds
 * until the first hurried afternoon — which is why the balance invariant is a
 * constraint trigger and tenant isolation is a policy rather than a `WHERE`
 * clause. The same argument applies to its own structure, and until now did
 * not: the layers were clean by convention, with nothing to stop the next
 * commit quietly reaching through one.
 *
 * The rules are few and each has a reason that is not aesthetic:
 *
 *  - **`lib/` knows nothing about the server.** It is the pure half — money,
 *    quantities, exact apportionment, CSV, the message catalogues. Every one
 *    of those is testable by handing it a value, and it stays that way only
 *    while it cannot reach a database.
 *
 *  - **`domain/` knows nothing about the database or the services.** The
 *    costing engine and the landed-cost allocator are the two places where
 *    getting the arithmetic wrong is expensive and invisible, and both are
 *    checked by handing them a list. An import of `db/` would end that.
 *
 *  - **Nothing on the server imports a component**, and no component imports a
 *    service directly. That boundary is what keeps three message catalogues
 *    and a Postgres driver out of the browser bundle.
 */

const ROOT = join(import.meta.dirname, '..', '..', 'src');

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry) ? [path] : [];
  });
}

type Import = { readonly specifier: string; readonly typeOnly: boolean };

/**
 * Every import in a file, with whether it was type-only.
 *
 * Read at the point of the match rather than looked up afterwards: a file can
 * import the same module twice, once for a type and once for a value, and
 * deciding from a second search would let the type-only one excuse the other.
 */
function importsOf(path: string): Import[] {
  const source = readFileSync(path, 'utf8');
  const matches = source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?['"]([^'"]+)['"]/gu,
  );
  return [...matches].map((match) => ({
    specifier: match[2] ?? '',
    typeOnly: Boolean(match[1]),
  }));
}

type Rule = {
  readonly name: string;
  /** Files this applies to, relative to `src`. */
  readonly within: (file: string) => boolean;
  /** An import that breaks it. */
  readonly forbids: (specifier: string) => boolean;
  readonly because: string;
};

const RULES: Rule[] = [
  {
    name: 'lib/ does not reach into the server',
    within: (file) => file.startsWith('lib/'),
    forbids: (to) => to.startsWith('@/server') || to.includes('server-only'),
    because:
      'lib/ is the pure half — money, quantities, apportionment, the message catalogues. It is testable by handing it a value, and stays that way only while it cannot reach a database.',
  },
  {
    name: 'lib/ does not reach into the UI',
    within: (file) => file.startsWith('lib/'),
    forbids: (to) => to.startsWith('@/components') || to.startsWith('@/app'),
    because: 'A pure module that imports a component is a component.',
  },
  {
    name: 'domain/ does not reach into the database or the services',
    within: (file) => file.startsWith('server/domain/'),
    forbids: (to) =>
      to.startsWith('@/server/db') ||
      to.startsWith('@/server/services') ||
      to.startsWith('@/server/http') ||
      to.startsWith('drizzle-orm'),
    because:
      'The costing engine and the landed-cost allocator are where wrong arithmetic is expensive and invisible. Both are checked by handing them a list, which needs them to have no I/O.',
  },
  {
    name: 'domain/ does not reach into the UI',
    within: (file) => file.startsWith('server/domain/'),
    forbids: (to) => to.startsWith('@/components') || to.startsWith('@/app'),
    because: 'Domain rules are not presentation.',
  },
  {
    name: 'the server does not import components',
    within: (file) => file.startsWith('server/'),
    forbids: (to) => to.startsWith('@/components'),
    because:
      'The dependency runs the other way: a page reads a service and hands the result to a component.',
  },
  {
    name: 'components do not import services or the database',
    within: (file) => file.startsWith('components/'),
    forbids: (to) =>
      to.startsWith('@/server/services') ||
      to.startsWith('@/server/db') ||
      to === 'drizzle-orm' ||
      to === 'pg',
    because:
      'Components receive data as props from a page. Importing a service pulls a Postgres driver toward the browser bundle, and importing the schema pulls the whole of it.',
  },
];

describe('architecture', () => {
  const files = sourceFiles(ROOT).map((path) => ({
    path,
    relative: relative(ROOT, path).replaceAll('\\', '/'),
  }));

  it('found the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(RULES.map((rule) => [rule.name, rule] as const))('%s', (_name, rule) => {
    const violations: string[] = [];

    for (const file of files) {
      if (!rule.within(file.relative)) continue;
      for (const { specifier, typeOnly } of importsOf(file.path)) {
        if (!rule.forbids(specifier)) continue;
        // A type-only import is erased at compile time: it constrains nothing
        // at runtime and pulls nothing into a bundle. Forbidding it would push
        // the code toward duplicating types instead, which is worse.
        if (typeOnly) continue;
        violations.push(`${file.relative} imports ${specifier}`);
      }
    }

    expect(violations, `\n${rule.because}\n`).toEqual([]);
  });
});
