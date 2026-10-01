import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Messages } from '@/lib/i18n';
import { Backdrop } from './backdrop';
import { headingId } from './section';

const SECTION = 'start';

/**
 * The last ask, made the same way as the first: the one-click sample ledger,
 * passed in as a slot for the same reason the hero takes it as one.
 */
export function ClosingCta({
  copy,
  primaryAction,
}: {
  copy: Messages['landing']['closing'];
  primaryAction: ReactNode;
}) {
  return (
    <section
      id={SECTION}
      aria-labelledby={headingId(SECTION)}
      className="relative isolate overflow-hidden px-4 py-28 sm:px-6 sm:py-36"
    >
      <Backdrop glow="center" />
      <div className="reveal mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
        <h2
          id={headingId(SECTION)}
          className="text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-6xl sm:leading-[1.02]"
        >
          {copy.title}
        </h2>
        <p className="text-ink-secondary text-lg leading-relaxed text-pretty">{copy.lede}</p>
        <div className="mt-2 flex w-full flex-col items-center gap-4">
          {primaryAction}
          <Link
            href="/overview"
            className="text-ink-secondary hover:text-ink text-sm underline-offset-4 hover:underline"
          >
            {copy.readOnly}
          </Link>
        </div>
      </div>
    </section>
  );
}
