import type { ComponentType, SVGProps } from 'react';
import type { Messages } from '@/lib/i18n';
import {
  ApiIcon,
  BankIcon,
  JournalIcon,
  ReceiptIcon,
  ReportsIcon,
  StockIcon,
  TagIcon,
  TransferIcon,
  WebhookIcon,
} from '@/components/icons';
import { Section, SectionHeading } from './section';
import { Spotlight } from './spotlight';
import { SpotlightCard } from './spotlight-card';

const SECTION = 'features';

type FeatureKey = keyof Messages['landing']['features']['items'];

/**
 * Each feature and the glyph the app's own navigation uses for it, so a
 * visitor who clicks through finds the same picture beside the same page.
 */
const FEATURES = [
  { key: 'currency', Icon: TransferIcon },
  { key: 'stock', Icon: StockIcon },
  { key: 'sales', Icon: TagIcon },
  { key: 'bank', Icon: BankIcon },
  { key: 'tax', Icon: ReceiptIcon },
  { key: 'statutory', Icon: ReportsIcon },
  { key: 'documents', Icon: JournalIcon },
  { key: 'webhooks', Icon: WebhookIcon },
  { key: 'api', Icon: ApiIcon },
] as const satisfies readonly {
  key: FeatureKey;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[];

export function Capabilities({ copy }: { copy: Messages['landing']['features'] }) {
  return (
    <Section id={SECTION}>
      <SectionHeading
        section={SECTION}
        eyebrow={copy.eyebrow}
        title={copy.title}
        lede={copy.lede}
      />

      <Spotlight className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ key, Icon }) => (
          <SpotlightCard key={key} className="reveal">
            <span className="bg-brand-glow text-brand ring-brand/25 flex size-10 items-center justify-center rounded-xl ring-1">
              <Icon width={18} height={18} />
            </span>
            <h3 className="mt-5 font-semibold tracking-tight">{copy.items[key].title}</h3>
            <p className="text-ink-secondary mt-2 text-sm leading-relaxed">
              {copy.items[key].body}
            </p>
          </SpotlightCard>
        ))}
      </Spotlight>
    </Section>
  );
}
