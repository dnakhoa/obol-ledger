import Link from 'next/link';
import type { Locale, Messages } from '@/lib/i18n';
import { Section, SectionHeading } from './section';
import { BalanceCheck } from './balance-check';

const SECTION = 'balanced';

/**
 * The invariant everything else stands on, made something to push against.
 *
 * Says plainly that the check on this page is a simulation and links to the
 * one that is not. A page about refusing to be wrong cannot let a reader
 * think a browser widget was Postgres.
 */
export function BalanceSection({
  copy,
  locale,
}: {
  copy: Messages['landing']['balance'];
  locale: Locale;
}) {
  return (
    <Section id={SECTION}>
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="space-y-6">
          <SectionHeading
            section={SECTION}
            eyebrow={copy.eyebrow}
            title={copy.title}
            lede={copy.lede}
          />
          <p className="reveal text-ink-muted max-w-xl text-sm leading-relaxed">
            {copy.simulated}{' '}
            <Link
              href="/break"
              className="text-ink decoration-brand underline decoration-2 underline-offset-4 hover:decoration-[3px]"
            >
              {copy.fireIt}
            </Link>
            .
          </p>
        </div>
        <div className="reveal">
          <BalanceCheck
            locale={locale}
            labels={{
              debit: copy.debit,
              credit: copy.credit,
              unit: copy.unit,
              balanced: copy.balanced,
              unbalanced: copy.unbalanced,
              makeItBalance: copy.makeItBalance,
              knockItOut: copy.knockItOut,
              scaleLabel: copy.scaleLabel,
              terminalTitle: copy.terminalTitle,
            }}
          />
        </div>
      </div>
    </Section>
  );
}
