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
  // Shown only when the database has no schema: its reader is whoever runs
  // the deployment, and the commands in it are the same in every language.
  'components/setup-notice.tsx',
];

/**
 * Text that is not prose: identifiers, format examples, units — and the labels
 * of a psql session on the attack page, `ERROR:` and `CONSTRAINT:`, which
 * reproduce what Postgres prints and are English in every language it runs in.
 */
const NOT_PROSE =
  /^(?:CONT-|GRN-|SO-|INV-|LOT-|PAV-|BLK-|MRB-|KK-|HD-|Obol$|API$|Webhook$|CSV$|Dr$|Cr$|ESC$|ERROR:$|CONSTRAINT:$)/u;

/**
 * JSX text nodes, across line breaks.
 *
 * The class has to include `\s`, not a literal space. It did not, which meant
 * this test could not see any text node containing a newline — which is to say
 * every sentence long enough to wrap, which is every sentence worth
 * translating. It shipped an untranslated paragraph onto the error page and
 * reported 421 passing tests while doing it. The `s` flag does not help: there
 * is no `.` here for it to widen.
 *
 * Text can also sit against an expression rather than a tag — `Set{' '}<code>`,
 * `Recorded {when}`, `{' '}— no account needed.` — so a run may start after
 * `}` and end before `{`, and may open with a dash. Requiring `>…<` on both
 * sides let three English sentences onto the sign-in page, and five more
 * elsewhere, while this test passed.
 */
const TEXT = /[>}]\s*([A-Z—–][A-Za-z0-9\s,.'’—–&;:!?%/()-]{6,}?)\s*(?=[<{])/gsu;

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
    // Trimmed, not just collapsed: an untrimmed `ESC ` fails to match an
    // anchored exemption, which is a confusing way to be told nothing is wrong.
    const text = (match[1] ?? '').trim().split(/\s+/u).join(' ');
    if (text.includes('{') || text.includes('}')) continue;
    // A dash standing in for an empty cell is punctuation, not prose.
    if (!/\p{L}/u.test(text)) continue;
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
