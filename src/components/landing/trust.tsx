import type { ComponentType, SVGProps } from 'react';
import type { Messages } from '@/lib/i18n';
import { ButtonLink } from '@/components/ui/button';
import { AccountsIcon, ArrowRightIcon, ScaleIcon, ShieldIcon } from '@/components/icons';
import { Section, SectionHeading } from './section';

const SECTION = 'trust';

type PromiseKey = keyof Messages['landing']['trust']['items'];

const PROMISES = [
  { key: 'balanced', Icon: ScaleIcon },
  { key: 'history', Icon: ShieldIcon },
  { key: 'tenants', Icon: AccountsIcon },
] as const satisfies readonly {
  key: PromiseKey;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[];

/**
 * Why the numbers can be believed, said the way a bookkeeper would say it.
 *
 * Each promise is one the database enforces — the attack page fires raw SQL
 * at all of them and shows Postgres refusing it — so the link at the bottom
 * is the evidence, for whoever wants it.
 */
export function Trust({ copy }: { copy: Messages['landing']['trust'] }) {
  return (
    <Section id={SECTION} className="bg-surface-sunken/50 border-line border-y">
      <SectionHeading
        section={SECTION}
        eyebrow={copy.eyebrow}
        title={copy.title}
        lede={copy.lede}
      />

      <ul className="mt-14 grid gap-4 md:grid-cols-3">
        {PROMISES.map(({ key, Icon }) => (
          <li key={key} className="reveal bg-surface border-line rounded-2xl border p-6">
            <span className="bg-brand-glow text-brand ring-brand/25 flex size-10 items-center justify-center rounded-xl ring-1">
              <Icon width={18} height={18} />
            </span>
            <h3 className="mt-5 font-semibold tracking-tight">{copy.items[key].title}</h3>
            <p className="text-ink-secondary mt-2 text-sm leading-relaxed">
              {copy.items[key].body}
            </p>
          </li>
        ))}
      </ul>

      <div className="reveal mt-10">
        <ButtonLink href="/break" size="lg" className="group">
          {copy.cta}
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
