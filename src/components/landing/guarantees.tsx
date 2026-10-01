import type { Messages } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { ArrowRightIcon, ShieldIcon } from '@/components/icons';
import { Section, SectionHeading } from './section';
import { Spotlight } from './spotlight';
import { SpotlightCard } from './spotlight-card';

const SECTION = 'guarantees';

type AttackKey = keyof Messages['breakIt']['attacks'];

/**
 * How Postgres answers each attack: its SQLSTATE and condition name, or —
 * for the read across tenants — no error at all, just nothing.
 *
 * In the order the README's table and the attack page use, and `satisfies`
 * the full set of keys, so a tenth attack added to the catalogue fails to
 * compile here until this page says how it is refused.
 */
const ANSWERS = {
  unbalanced: { sqlstate: '23514', condition: 'check_violation' },
  rewrite: { sqlstate: '23001', condition: 'restrict_violation' },
  erase: { sqlstate: '23001', condition: 'restrict_violation' },
  overdraw: { sqlstate: '23514', condition: 'check_violation' },
  wrongCurrency: { sqlstate: '23503', condition: 'foreign_key_violation' },
  reverseTwice: { sqlstate: '23505', condition: 'unique_violation' },
  backdate: { sqlstate: '23001', condition: 'restrict_violation' },
  plant: { sqlstate: '42501', condition: 'insufficient_privilege' },
  peek: null,
} as const satisfies Record<AttackKey, { sqlstate: string; condition: string } | null>;

const ORDER = Object.keys(ANSWERS) as AttackKey[];

/**
 * Nine ways to corrupt a ledger, and the one line of Postgres that stops each.
 *
 * The titles and guards are the attack page's own catalogue entries, not a
 * second wording of them: this section is a preview of `/break`, and the two
 * must not drift into describing different things.
 */
export function Guarantees({
  copy,
  attacks,
  verdicts,
}: {
  copy: Messages['landing']['guarantees'];
  attacks: Messages['breakIt']['attacks'];
  verdicts: { readonly refused: string; readonly held: string };
}) {
  return (
    <Section id={SECTION}>
      <SectionHeading
        section={SECTION}
        eyebrow={copy.eyebrow}
        title={copy.title}
        lede={copy.lede}
      />

      <Spotlight className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((key, index) => {
          const answer = ANSWERS[key];
          return (
            <SpotlightCard key={key} className="reveal flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted numeric font-mono text-xs">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Badge tone="positive">
                  <ShieldIcon width={11} height={11} />
                  {answer ? verdicts.refused : verdicts.held}
                </Badge>
              </div>
              <h3 className="mt-5 text-lg leading-snug font-semibold tracking-tight">
                {attacks[key].title}
              </h3>
              <p className="text-ink-secondary mt-2 flex-1 text-sm leading-relaxed">
                {attacks[key].guard}
              </p>
              <p className="bg-terminal ring-terminal-line mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 font-mono text-[11.5px] ring-1">
                <span className="text-terminal-muted">{copy.postgresSays}</span>
                {answer ? (
                  <span className="text-terminal-error">
                    {answer.sqlstate} {answer.condition}
                  </span>
                ) : (
                  <span className="text-terminal-ok">{copy.noRows}</span>
                )}
              </p>
            </SpotlightCard>
          );
        })}
      </Spotlight>

      <div className="reveal mt-12 flex justify-center">
        <ButtonLink href="/break" variant="brand" size="lg" className="group">
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
