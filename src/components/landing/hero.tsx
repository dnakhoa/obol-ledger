import type { ReactNode } from 'react';
import Image, { type StaticImageData } from 'next/image';
import type { Messages } from '@/lib/i18n';
import { ButtonLink } from '@/components/ui/button';
import { ArrowRightIcon } from '@/components/icons';
import { Backdrop } from './backdrop';
import { BrowserFrame } from './browser-frame';
import { headingId } from './section';

const SECTION = 'hero';

/**
 * The first screen: what Obol is, who it is for, the way in, and the product
 * itself underneath.
 *
 * The primary action arrives as a slot rather than being built here, because
 * it is the sign-in page's own sample-ledger button, wired to the server
 * action both pages share. The hero lays it out; it does not need to know how
 * a sample ledger is made.
 */
export function Hero({
  copy,
  primaryAction,
  screenshot,
}: {
  copy: Messages['landing']['hero'];
  primaryAction: ReactNode;
  screenshot: StaticImageData;
}) {
  return (
    <section
      aria-labelledby={headingId(SECTION)}
      className="relative isolate overflow-x-clip px-4 pt-32 pb-20 sm:px-6 sm:pt-40 sm:pb-28"
    >
      <Backdrop />
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-7 text-center">
        <p className="animate-rise border-line bg-surface/60 text-ink-secondary inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-sm">
          <span aria-hidden="true" className="bg-positive size-1.5 rounded-full" />
          {copy.eyebrow}
        </p>

        <h1
          id={headingId(SECTION)}
          className="animate-rise text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance [animation-delay:90ms] sm:text-6xl"
        >
          {copy.title}
        </h1>

        <p className="animate-rise text-ink-secondary max-w-2xl text-lg leading-relaxed text-pretty [animation-delay:180ms] sm:text-xl">
          {copy.lede}
        </p>

        <div className="animate-rise flex w-full flex-col items-center gap-4 [animation-delay:270ms]">
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            {primaryAction}
            <ButtonLink href="/overview" size="lg" className="group">
              {copy.secondary}
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

      <div className="animate-rise relative mx-auto mt-16 max-w-5xl [animation-delay:360ms] sm:mt-20">
        <div
          aria-hidden="true"
          className="bg-brand-glow absolute inset-x-[10%] -bottom-10 h-1/2 rounded-full blur-3xl"
        />
        <BrowserFrame path="/overview" className="shadow-[var(--shadow-hero)]">
          <Image
            src={screenshot}
            alt={copy.imageAlt}
            placeholder="blur"
            priority
            sizes="(min-width: 1024px) 64rem, 100vw"
            className="h-auto w-full rounded-xl"
          />
        </BrowserFrame>
      </div>
    </section>
  );
}
