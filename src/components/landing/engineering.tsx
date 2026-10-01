import type { Messages } from '@/lib/i18n';
import { ArrowRightIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { Section, SectionHeading } from './section';
import { TerminalFrame } from './terminal-frame';

const SECTION = 'engineering';

type ProofKey = keyof Messages['landing']['engineering']['proofs'];

/**
 * The line each proof deletes or adds, quoted from the source.
 *
 * Real lines from the files named, so a sceptical reader can open the file
 * and find them. `sign` is the diff's: `-` a line taken out, `+` one put in.
 */
const PROOFS = [
  {
    key: 'sort',
    file: 'src/server/services/journal.ts',
    sign: '-',
    line: '.sort((left, right) => (left.accountId < right.accountId ? -1 : 1));',
  },
  {
    key: 'skipLocked',
    file: 'src/server/services/webhook-dispatcher.ts',
    sign: '-',
    line: 'FOR UPDATE OF due SKIP LOCKED',
  },
  {
    key: 'bypassRls',
    file: 'psql',
    sign: '+',
    line: 'ALTER ROLE obol_app BYPASSRLS;',
  },
] as const satisfies readonly {
  key: ProofKey;
  file: string;
  sign: '-' | '+';
  line: string;
}[];

export function Engineering({ copy }: { copy: Messages['landing']['engineering'] }) {
  return (
    <Section id={SECTION}>
      <SectionHeading
        section={SECTION}
        eyebrow={copy.eyebrow}
        title={copy.title}
        lede={copy.lede}
      />

      {/*
        Each proof spans two rows of the list's grid and lays its own parts on
        them (subgrid), so a code line that wraps in one card pushes every
        card's caption down together instead of leaving them out of line.
      */}
      <ol className="mt-14 grid gap-x-4 gap-y-5 lg:grid-cols-3">
        {PROOFS.map(({ key, file, sign, line }) => (
          <li key={key} className="reveal row-span-2 grid grid-rows-subgrid gap-5 max-lg:mb-6">
            <TerminalFrame title={file}>
              <p className="p-3">
                <span
                  className={cn(
                    'block h-full rounded-md px-2 py-1.5 break-words',
                    sign === '-'
                      ? 'bg-terminal-error/10 text-terminal-error'
                      : 'bg-terminal-ok/10 text-terminal-ok',
                  )}
                >
                  <span aria-hidden="true" className="mr-2 select-none">
                    {sign}
                  </span>
                  {line}
                </span>
              </p>
            </TerminalFrame>
            <div className="space-y-2 px-1">
              <p className="font-medium">{copy.proofs[key].change}</p>
              <p className="text-ink-secondary flex items-start gap-2 text-sm leading-relaxed">
                <ArrowRightIcon width={14} height={14} className="text-brand mt-1 shrink-0" />
                <span>{copy.proofs[key].result}</span>
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="reveal border-line mt-16 border-t pt-10">
        <h3 className="text-ink-muted font-mono text-xs tracking-[0.18em] uppercase">
          {copy.practicesLabel}
        </h3>
        <ul className="mt-5 flex flex-wrap gap-2">
          {Object.entries(copy.practices).map(([key, practice]) => (
            <li
              key={key}
              className="border-line bg-surface/60 text-ink-secondary rounded-full border px-3.5 py-1.5 text-sm"
            >
              {practice}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
