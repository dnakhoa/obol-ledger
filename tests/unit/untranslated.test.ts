import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * English text left in a component that should be translated.
 *
 * This exists because I twice declared the interface fully translated and was
 * twice wrong — the check I was eyeballing matched `>Text<` on one line and
 * could not see JSX text that had been wrapped, which is most of it. A claim
 * about coverage that a person verifies by looking is a claim that drifts on
 * the next commit.
 *
 * So the check is a test, and it is deliberately crude in the direction of
 * false positives: a string it flags wrongly costs one entry in the list
 * below, and a string it misses ships an English sentence into a Vietnamese
 * page, which is invisible to whoever wrote it.
 */

const ROOT = join(import.meta.dirname, '..', '..', 'src');

/**
 * Surfaces that stay English on purpose.
 *
 * `/api-reference` and `/webhooks` document an HTTP API whose field names and
 * error codes are English and will be read by somebody writing code against
 * it; translating the prose around `unbalanced_transaction` while leaving the
 * identifier alone makes those pages harder to use, not easier. `settings`
 * and the two credential forms are the same audience. See ADR 14.
 */
const DELIBERATELY_ENGLISH = [
  'app/(app)/api-reference/',
  'app/(app)/settings/',
  'app/(app)/webhooks/',
  'components/api-key-form.tsx',
  'components/endpoint-form.tsx',
  'app/opengraph-image.tsx',
];

/** Text that is not prose: identifiers, format examples, units. */
const NOT_PROSE = /^(?:CONT-|GRN-|SO-|INV-|LOT-|PAV-|BLK-|MRB-|Obol$|API$|Webhook$|CSV$|Dr$|Cr$)/u;

/** JSX text nodes, across line breaks. */
const TEXT = />\s*([A-Z][A-Za-z0-9 ,.'’—–&/()-]{6,}?)\s*</gsu;

/** Props whose value is shown to a person. */
const PROP =
  /\b(?:label|hint|title|description|placeholder|caption|noun|aria-label|pendingLabel|doneLabel|confirm)="([A-Z][^"]{5,})"/gu;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return files(path);
    return entry.endsWith('.tsx') ? [path] : [];
  });
}

function englishIn(source: string): string[] {
  // Comments hold prose by design, and a generic like `Promise<Row>` reads as
  // a text node to anything that is not a parser. A JSX element always has its
  // `<` *before* the name, so a capitalised identifier followed directly by
  // `<` is a type argument and never markup.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/(?<!<)\b[A-Z]\w*<[^<>]*>/gu, '');

  const found: string[] = [];
  for (const match of code.matchAll(TEXT)) {
    const text = (match[1] ?? '').split(/\s+/u).join(' ');
    if (text.includes('{') || text.includes('}')) continue;
    if (NOT_PROSE.test(text)) continue;
    found.push(text);
  }
  for (const match of code.matchAll(PROP)) {
    const text = match[1] ?? '';
    if (NOT_PROSE.test(text)) continue;
    found.push(text);
  }
  return found;
}

describe('the interface speaks the reader’s language', () => {
  const sources = files(ROOT).map((path) => ({
    path,
    relative: relative(ROOT, path).replaceAll('\\', '/'),
  }));

  it('found the components', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('has no English left in a surface that should be translated', () => {
    const offenders: string[] = [];

    for (const source of sources) {
      if (DELIBERATELY_ENGLISH.some((prefix) => source.relative.startsWith(prefix))) continue;
      for (const text of englishIn(readFileSync(source.path, 'utf8'))) {
        offenders.push(`${source.relative}: ${text}`);
      }
    }

    expect(
      offenders,
      '\nEnglish text in a translated surface. Move it to the message catalogues, ' +
        'or add the file to DELIBERATELY_ENGLISH with a reason.\n',
    ).toEqual([]);
  });
});
