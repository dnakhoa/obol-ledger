import type { Messages } from '@/lib/i18n';

type StatKey = Exclude<keyof Messages['landing']['stats'], 'label'>;

export type Figure = { readonly key: StatKey; readonly value: string };

/**
 * Five numbers, each one checkable in the repository.
 *
 * A description list, because that is what it is: a term and its value. The
 * value is drawn first and larger, but it comes second in the source, so a
 * screen reader hears "tests, run against real Postgres: 1,100+" rather than
 * a bare number with its meaning trailing after.
 */
export function ProofStats({
  copy,
  figures,
}: {
  copy: Messages['landing']['stats'];
  figures: readonly Figure[];
}) {
  return (
    <section aria-label={copy.label} className="border-line border-y px-4 sm:px-6">
      <dl className="divide-line mx-auto grid w-full max-w-6xl grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        {figures.map(({ key, value }) => (
          // `justify-end` in a reversed column is the top: the numbers share
          // a line however many lines their labels wrap to.
          <div
            key={key}
            className="reveal flex flex-col-reverse justify-end gap-1.5 px-2 py-8 lg:px-6"
          >
            <dt className="text-ink-muted text-sm leading-snug text-pretty">{copy[key]}</dt>
            <dd className="numeric text-4xl font-semibold tracking-tight sm:text-5xl">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
