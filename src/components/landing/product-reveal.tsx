import Image, { type StaticImageData } from 'next/image';
import type { Messages } from '@/lib/i18n';
import { ButtonLink } from '@/components/ui/button';
import { ArrowRightIcon } from '@/components/icons';
import { Section, SectionHeading } from './section';

const SECTION = 'product';

/**
 * The dashboard, tilting up from the page as it scrolls in.
 *
 * The screenshot is handed in rather than imported here, so this component
 * says how a product is shown and the page decides which picture. A static
 * import gives `next/image` its intrinsic size, so the frame reserves its
 * height before the image arrives and nothing below it jumps.
 */
export function ProductReveal({
  copy,
  screenshot,
}: {
  copy: Messages['landing']['product'];
  screenshot: StaticImageData;
}) {
  return (
    <Section id={SECTION} className="overflow-x-clip">
      <SectionHeading
        section={SECTION}
        eyebrow={copy.eyebrow}
        title={copy.title}
        lede={copy.lede}
        align="center"
      />

      <div className="tilt-in relative mx-auto mt-16 max-w-5xl">
        <div
          aria-hidden="true"
          className="bg-brand-glow absolute inset-x-[10%] -bottom-10 h-1/2 rounded-full blur-3xl"
        />
        <figure className="border-line-strong bg-surface relative overflow-hidden rounded-2xl border p-1.5 shadow-[var(--shadow-hero)]">
          <div aria-hidden="true" className="flex h-8 items-center gap-1.5 px-3">
            <span className="bg-line-strong size-2.5 rounded-full" />
            <span className="bg-line-strong size-2.5 rounded-full" />
            <span className="bg-line-strong size-2.5 rounded-full" />
            <span className="bg-surface-sunken text-ink-muted mx-auto rounded-md px-16 py-0.5 font-mono text-[11px]">
              obol-ledger.vercel.app/overview
            </span>
          </div>
          <Image
            src={screenshot}
            alt={copy.imageAlt}
            placeholder="blur"
            sizes="(min-width: 1024px) 64rem, 100vw"
            className="h-auto w-full rounded-xl"
          />
        </figure>
      </div>

      <div className="reveal mt-12 flex justify-center">
        <ButtonLink href="/overview" size="lg" className="group">
          {copy.open}
          <ArrowRightIcon
            width={16}
            height={16}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </ButtonLink>
      </div>
    </Section>
  );
}
