import type { Messages } from '@/lib/i18n';
import { ButtonLink } from '@/components/ui/button';
import { ApiIcon, CheckIcon } from '@/components/icons';
import { Section, SectionHeading } from './section';

const SECTION = 'developers';
const SOURCE = 'https://github.com/dnakhoa/obol-ledger';

/** The short version for whoever would run it or connect to it. */
export function Developers({ copy }: { copy: Messages['landing']['developers'] }) {
  return (
    <Section id={SECTION}>
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <SectionHeading
          section={SECTION}
          eyebrow={copy.eyebrow}
          title={copy.title}
          lede={copy.lede}
        />

        <div className="reveal space-y-8 lg:pt-10">
          <ul className="space-y-4">
            {copy.points.map((point) => (
              <li key={point} className="flex gap-3 leading-relaxed">
                <CheckIcon
                  width={18}
                  height={18}
                  aria-hidden="true"
                  className="text-brand mt-0.5 shrink-0"
                />
                {point}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/api-reference" size="lg">
              <ApiIcon width={16} height={16} />
              {copy.docs}
            </ButtonLink>
            {/* Leaves the site, so a plain anchor rather than the router's Link. */}
            <a
              href={SOURCE}
              rel="noopener noreferrer"
              className="text-ink-secondary hover:text-ink hover:bg-surface-hover inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-medium transition-colors duration-150"
            >
              {copy.source}
            </a>
          </div>
        </div>
      </div>
    </Section>
  );
}
