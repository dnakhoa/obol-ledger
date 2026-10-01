import type { ReactNode } from 'react';
import type { Messages } from '@/lib/i18n';
import { ButtonLink } from '@/components/ui/button';
import { ArrowRightIcon } from '@/components/icons';
import { Backdrop } from './backdrop';
import { RefusalTerminal } from './refusal-terminal';
import { headingId } from './section';

const SECTION = 'hero';

/**
 * The first screen: the claim, the proof of it running, and the way in.
 *
 * The primary action arrives as a slot rather than being built here, because
 * it is the sign-in page's own sample-ledger button, wired to the server
 * action both pages share. The hero lays it out; it does not need to know how
 * a sample ledger is made.
 */
export function Hero({
  copy,
  primaryAction,
}: {
  copy: Messages['landing']['hero'];
  primaryAction: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId(SECTION)}
      className="relative isolate px-4 pt-32 pb-20 sm:px-6 sm:pt-40 lg:pb-28"
    >
      <Backdrop />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        <div className="space-y-8">
          <p className="animate-rise border-line bg-surface/60 text-ink-secondary inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-sm">
            <span aria-hidden="true" className="bg-positive size-1.5 rounded-full" />
            {copy.eyebrow}
          </p>

          <h1
            id={headingId(SECTION)}
            className="animate-rise text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.04em] text-balance [animation-delay:90ms] sm:text-6xl lg:text-7xl"
          >
            {/*
              No spaces added here: the catalogue carries them, because
              Japanese puts none between these three parts and English needs
              one on each side of the verb.
            */}
            {copy.titleLead}
            <span className="text-brand relative inline-block whitespace-nowrap">
              {copy.titleAccent}
              <svg
                aria-hidden="true"
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                className="absolute -bottom-[0.08em] left-0 h-[0.16em] w-full overflow-visible"
              >
                <path
                  d="M2 9C52 3 128 1 198 6"
                  pathLength={1}
                  strokeDasharray="1"
                  className="animate-draw stroke-brand"
                  strokeWidth={3}
                  strokeLinecap="round"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </span>
            {copy.titleTail}
          </h1>

          <p className="animate-rise text-ink-secondary max-w-xl text-lg leading-relaxed text-pretty [animation-delay:180ms] sm:text-xl">
            {copy.lede}
          </p>

          <div className="animate-rise space-y-4 [animation-delay:270ms]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {primaryAction}
              <ButtonLink href="/break" size="lg" className="group">
                {copy.breakIt}
                <ArrowRightIcon
                  width={16}
                  height={16}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </ButtonLink>
            </div>
            <p className="text-ink-muted text-sm">{copy.reassurance}</p>
          </div>
        </div>

        <div className="animate-rise relative [animation-delay:360ms]">
          <RefusalTerminal
            labels={{
              title: copy.terminalTitle,
              pause: copy.pause,
              play: copy.play,
              transcript: copy.transcript,
            }}
          />
        </div>
      </div>
    </section>
  );
}
