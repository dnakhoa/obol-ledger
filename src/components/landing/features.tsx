import Image, { type StaticImageData } from 'next/image';
import type { Messages } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { ArrowRightIcon, CheckIcon } from '@/components/icons';
import { ButtonLink } from '@/components/ui/button';
import { BrowserFrame } from './browser-frame';
import { Section, SectionHeading } from './section';

const SECTION = 'features';

export type FeatureKey = keyof Messages['landing']['features']['items'];

/**
 * Each feature, in the order a month runs, and the page of the demo that
 * shows it. The screenshot beside it was taken on that page.
 */
const FEATURES = [
  { key: 'sales', href: '/sales' },
  { key: 'stock', href: '/stock' },
  { key: 'bank', href: '/bank' },
  { key: 'tax', href: '/tax' },
] as const satisfies readonly { key: FeatureKey; href: string }[];

/**
 * What the product does, one job at a time: a few plain sentences, three
 * specifics, and the real screen beside them. Alternating sides, so the eye
 * reads down the page in a zig-zag rather than down one column of text.
 */
export function Features({
  copy,
  screenshots,
}: {
  copy: Messages['landing']['features'];
  screenshots: Record<FeatureKey, StaticImageData>;
}) {
  return (
    <Section id={SECTION}>
      <SectionHeading
        section={SECTION}
        eyebrow={copy.eyebrow}
        title={copy.title}
        lede={copy.lede}
        align="center"
      />

      <div className="mt-20 space-y-24 sm:mt-24 sm:space-y-32">
        {FEATURES.map(({ key, href }, index) => {
          const item = copy.items[key];
          return (
            <article
              key={key}
              aria-labelledby={`feature-${key}`}
              className={cn(
                'reveal grid items-center gap-10 lg:gap-16',
                index % 2 === 0 ? 'lg:grid-cols-[2fr_3fr]' : 'lg:grid-cols-[3fr_2fr]',
              )}
            >
              <div className={cn('space-y-5', index % 2 === 1 && 'lg:order-last')}>
                <h3
                  id={`feature-${key}`}
                  className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
                >
                  {item.title}
                </h3>
                <p className="text-ink-secondary leading-relaxed text-pretty">{item.body}</p>
                <ul className="space-y-2.5 text-sm">
                  {item.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <CheckIcon
                        width={16}
                        height={16}
                        aria-hidden="true"
                        className="text-brand mt-0.5 shrink-0"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
                <ButtonLink href={href} variant="ghost" className="group -ml-4">
                  {copy.open}
                  <ArrowRightIcon
                    width={14}
                    height={14}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </ButtonLink>
              </div>

              <BrowserFrame path={href} className="shadow-[var(--shadow-raised)]">
                <Image
                  src={screenshots[key]}
                  alt={item.imageAlt}
                  placeholder="blur"
                  sizes="(min-width: 1024px) 40rem, 100vw"
                  className="h-auto w-full rounded-xl"
                />
              </BrowserFrame>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
