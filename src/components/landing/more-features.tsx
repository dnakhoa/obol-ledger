import type { ComponentType, SVGProps } from 'react';
import type { Messages } from '@/lib/i18n';
import {
  ApiIcon,
  CalendarIcon,
  GlobeIcon,
  JournalIcon,
  SearchIcon,
  TransferIcon,
} from '@/components/icons';
import { headingId } from './section';

const SECTION = 'more';

type ItemKey = keyof Messages['landing']['more']['items'];

/**
 * Each item and its glyph — the one the app's own navigation uses, where the
 * item has a page there, so a visitor who clicks through finds the same
 * picture beside it.
 */
const ITEMS = [
  { key: 'currency', Icon: TransferIcon },
  { key: 'documents', Icon: JournalIcon },
  { key: 'close', Icon: CalendarIcon },
  { key: 'languages', Icon: GlobeIcon },
  { key: 'search', Icon: SearchIcon },
  { key: 'api', Icon: ApiIcon },
] as const satisfies readonly {
  key: ItemKey;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[];

/** The smaller things that come with it: a list to scan, not to read. */
export function MoreFeatures({ copy }: { copy: Messages['landing']['more'] }) {
  return (
    <section aria-labelledby={headingId(SECTION)} className="px-4 pb-24 sm:px-6 sm:pb-32">
      <div className="border-line mx-auto w-full max-w-6xl border-t pt-16">
        <h2 id={headingId(SECTION)} className="text-xl font-semibold tracking-tight">
          {copy.title}
        </h2>
        <ul className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map(({ key, Icon }) => (
            <li key={key} className="reveal flex gap-4">
              <span className="bg-surface text-ink-secondary ring-line flex size-9 shrink-0 items-center justify-center rounded-lg ring-1">
                <Icon width={16} height={16} />
              </span>
              <div>
                <h3 className="font-medium">{copy.items[key].title}</h3>
                <p className="text-ink-secondary mt-1 text-sm leading-relaxed">
                  {copy.items[key].body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
