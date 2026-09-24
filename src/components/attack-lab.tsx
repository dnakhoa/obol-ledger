'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { groupDecimalString } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { separatorsFor } from '@/lib/i18n/separators';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { AlertIcon, CheckIcon, CrossIcon, PlayIcon, ShieldIcon } from './icons';
import type { AttackActionResult } from '@/app/(app)/break/actions';
import type {
  AttackConnection,
  AttackId,
  AttackPlan,
  AttackResult,
  AttackVerdict,
} from '@/server/services/attacks';

type AttackCopy = { readonly title: string; readonly guard: string; readonly why: string };

export type AttackLabLabels = {
  readonly runAll: string;
  readonly runAgain: string;
  readonly running: string;
  readonly run: string;
  readonly scoreboard: string;
  readonly scoreIdle: string;
  readonly score: string;
  readonly breachedCount: string;
  readonly written: string;
  readonly writtenNote: string;
  readonly connection: string;
  readonly connectionBypass: string;
  readonly aimedAt: string;
  readonly stoppedBy: string;
  readonly verdictRefused: string;
  readonly verdictHeld: string;
  readonly verdictBreached: string;
  readonly verdictUnavailable: string;
  readonly refusedIn: string;
  readonly heldIn: string;
  readonly breachedNote: string;
  readonly unavailableNote: string;
  readonly skipped: string;
  readonly rateLimited: string;
  readonly failed: string;
  readonly sqlLabel: string;
  readonly attacks: Record<AttackId, AttackCopy>;
};

type Slot =
  | { readonly state: 'idle' }
  | { readonly state: 'running' }
  | { readonly state: 'done'; readonly result: AttackResult }
  | { readonly state: 'error'; readonly message: string };

const HOLDS: ReadonlySet<AttackVerdict> = new Set(['refused', 'held']);

/**
 * "Try to break it": the attacks, their SQL, and what Postgres said back.
 *
 * The one piece of the page that needs the browser, because a result arrives
 * after a click. Everything it shows before that — the SQL, the targets — was
 * aimed on the server and arrives as props, so the page is readable with
 * JavaScript off; only the firing needs it.
 *
 * "Run all" fires the attacks one after another rather than at once. They
 * would be refused just the same in parallel, but nine verdicts landing in the
 * same frame read as a page load; one at a time, they read as nine separate
 * refusals, which is what they are.
 */
export function AttackLab({
  plans,
  connection,
  labels,
  locale,
  run,
}: {
  plans: readonly AttackPlan[];
  connection: AttackConnection;
  labels: AttackLabLabels;
  locale: Locale;
  run: (id: string) => Promise<AttackActionResult>;
}) {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [runningAll, setRunningAll] = useState(false);

  const slotOf = (id: AttackId): Slot => slots[id] ?? { state: 'idle' };

  async function fire(id: AttackId): Promise<boolean> {
    setSlots((current) => ({ ...current, [id]: { state: 'running' } }));
    let outcome: AttackActionResult;
    try {
      outcome = await run(id);
    } catch {
      outcome = { ok: false, reason: 'failed' };
    }
    const slot: Slot = outcome.ok
      ? { state: 'done', result: outcome.result }
      : {
          state: 'error',
          message:
            outcome.reason === 'rate_limited'
              ? fill(labels.rateLimited, { seconds: outcome.retryAfterSeconds })
              : labels.failed,
        };
    setSlots((current) => ({ ...current, [id]: slot }));
    return outcome.ok;
  }

  async function fireAll() {
    setRunningAll(true);
    setSlots({});
    for (const plan of plans) {
      // Stop at the first failure to reach the server: carrying on would only
      // spend the rest of the quota on the same error.
      if (!(await fire(plan.id))) break;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    setRunningAll(false);
  }

  const finished = plans
    .map((plan) => slotOf(plan.id))
    .filter((slot): slot is Extract<Slot, { state: 'done' }> => slot.state === 'done');
  const attempted = finished.filter((slot) => slot.result.verdict !== 'unavailable');
  const stopped = attempted.filter((slot) => HOLDS.has(slot.result.verdict)).length;
  const breached = attempted.length - stopped;
  const busy = runningAll || plans.some((plan) => slotOf(plan.id).state === 'running');

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
          <div className="min-w-0 space-y-1">
            <p className="text-ink-muted text-[11px] font-medium tracking-wide uppercase">
              {labels.scoreboard}
            </p>
            <p
              className="text-lg font-semibold tracking-tight sm:text-xl"
              aria-live="polite"
              aria-atomic="true"
            >
              {attempted.length === 0 ? (
                <span className="text-ink-secondary text-sm font-normal sm:text-base">
                  {labels.scoreIdle}
                </span>
              ) : (
                <>
                  <span className="numeric">
                    {fill(labels.score, { stopped, total: attempted.length })}
                  </span>
                  {breached > 0 ? (
                    <span className="text-negative ml-2 text-sm font-medium">
                      · {fill(labels.breachedCount, { count: breached })}
                    </span>
                  ) : null}
                </>
              )}
            </p>
          </div>
          <Button size="lg" onClick={fireAll} disabled={busy}>
            <PlayIcon />
            {runningAll ? labels.running : finished.length > 0 ? labels.runAgain : labels.runAll}
          </Button>
        </div>

        {/* One segment per attack, filling in as the verdicts land. */}
        <ol className="flex gap-1 px-4 pb-4 sm:px-5" aria-hidden="true">
          {plans.map((plan) => {
            const slot = slotOf(plan.id);
            const verdict = slot.state === 'done' ? slot.result.verdict : null;
            return (
              <li key={plan.id} className="flex-1">
                <a
                  href={`#attack-${plan.id}`}
                  tabIndex={-1}
                  className={cn(
                    'relative block h-2 overflow-hidden rounded-full transition-colors duration-300',
                    verdict === null && 'bg-surface-sunken',
                    verdict !== null && HOLDS.has(verdict) && 'bg-positive',
                    verdict === 'breached' && 'bg-negative',
                    verdict === 'unavailable' && 'bg-line-strong',
                    slot.state === 'error' && 'bg-caution',
                  )}
                >
                  {slot.state === 'running' ? (
                    <span className="bg-series animate-scan absolute inset-y-0 left-0 w-1/3 rounded-full" />
                  ) : null}
                </a>
              </li>
            );
          })}
        </ol>

        <div className="border-line bg-surface-sunken text-ink-secondary flex flex-wrap items-start gap-x-6 gap-y-2 border-t px-4 py-3 text-xs sm:px-5">
          <p className="flex items-center gap-1.5">
            <CheckIcon className="text-positive shrink-0" width={14} height={14} />
            <span>
              <strong className="text-ink font-medium">{labels.written}</strong> —{' '}
              {labels.writtenNote}
            </span>
          </p>
          <p className="flex items-center gap-1.5">
            {connection.bypassesRls ? (
              <AlertIcon className="text-caution shrink-0" width={14} height={14} />
            ) : (
              <ShieldIcon className="text-positive shrink-0" width={14} height={14} />
            )}
            <span>
              {fill(connection.bypassesRls ? labels.connectionBypass : labels.connection, {
                role: connection.role,
              })}
            </span>
          </p>
        </div>
      </Card>

      <ol className="grid gap-4 lg:grid-cols-2">
        {plans.map((plan, index) => (
          <li key={plan.id} id={`attack-${plan.id}`} className="scroll-mt-20">
            <AttackCard
              index={index}
              plan={plan}
              slot={slotOf(plan.id)}
              copy={labels.attacks[plan.id]}
              labels={labels}
              locale={locale}
              disabled={busy}
              onRun={() => void fire(plan.id)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function AttackCard({
  index,
  plan,
  slot,
  copy,
  labels,
  locale,
  disabled,
  onRun,
}: {
  index: number;
  plan: AttackPlan;
  slot: Slot;
  copy: AttackCopy;
  labels: AttackLabLabels;
  locale: Locale;
  disabled: boolean;
  onRun: () => void;
}) {
  const result = slot.state === 'done' ? slot.result : null;
  // The result's SQL when there is one: the attack re-aims when it fires, and
  // the page should show what actually ran rather than what was planned.
  const shown = result ?? plan;
  const target = shown.target;
  const running = slot.state === 'running';

  return (
    <Card
      className={cn(
        'flex h-full flex-col transition-[border-color,box-shadow] duration-300',
        result?.verdict === 'breached' && 'border-negative',
        running && 'border-series',
      )}
    >
      <div className="space-y-2 px-4 pt-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-muted font-mono text-xs">
            {String(index + 1).padStart(2, '0')}
          </span>
          {result ? <Verdict verdict={result.verdict} labels={labels} /> : null}
        </div>
        <h2 className="text-base font-semibold tracking-tight">{copy.title}</h2>
        <p className="text-ink-secondary text-sm">{copy.why}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pt-1 text-xs">
          <dt className="text-ink-muted">{labels.stoppedBy}</dt>
          <dd className="text-ink font-medium">{copy.guard}</dd>
          {target ? (
            <>
              <dt className="text-ink-muted">{labels.aimedAt}</dt>
              <dd className="text-ink-secondary truncate" title={target.label}>
                {target.label}
                {target.amount ? (
                  <span className="text-ink numeric ml-1.5 font-mono">
                    {groupDecimalString(target.amount, separatorsFor(locale))} {target.currency}
                  </span>
                ) : target.currency ? (
                  <span className="text-ink ml-1.5 font-mono">{target.currency}</span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <Terminal label={labels.sqlLabel} running={running}>
        {shown.statements.length === 0 ? (
          <p className="text-terminal-muted">-- {labels.unavailableNote}</p>
        ) : (
          shown.statements.map((statement, position) => {
            const refused = result?.refusedAt === position;
            const skipped =
              result?.refusedAt !== null &&
              result?.refusedAt !== undefined &&
              position > result.refusedAt;
            const ran = result !== null && !refused && !skipped;
            return (
              <div
                key={position}
                className={cn(
                  'relative border-l-2 pl-3',
                  refused ? 'border-terminal-error' : 'border-transparent',
                  skipped && 'opacity-45',
                )}
              >
                {/*
                  Wrapped rather than scrolled: a ULID is 31 characters with
                  nowhere to break, and a statement that runs off the card
                  hides the half that says what it does.
                */}
                <pre className="break-all whitespace-pre-wrap">
                  <Sql text={statement} />
                </pre>
                {ran && result.verdict !== 'unavailable' ? (
                  <p className="text-terminal-ok mt-0.5">
                    {result.rowsSeen !== null ? `(${result.rowsSeen} rows)` : 'OK'}
                  </p>
                ) : null}
                {skipped ? <p className="text-terminal-muted mt-0.5">-- {labels.skipped}</p> : null}
                {refused && result.error ? (
                  <div className="animate-verdict-in text-terminal-error mt-1.5 origin-left">
                    <p className="font-semibold">
                      ERROR: {result.error.sqlstate} {result.error.condition}
                    </p>
                    <p className="whitespace-pre-wrap">{result.error.message}</p>
                    {result.error.constraint ? (
                      <p className="text-terminal-muted">CONSTRAINT: {result.error.constraint}</p>
                    ) : null}
                  </div>
                ) : null}
                {position < shown.statements.length - 1 ? <div className="h-2.5" /> : null}
              </div>
            );
          })
        )}
        {result && result.verdict !== 'unavailable' ? (
          <p className="text-terminal-muted mt-2.5">ROLLBACK</p>
        ) : null}
      </Terminal>

      <footer className="border-line mt-auto flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
        <p className="text-ink-muted min-w-0 text-xs" aria-live="polite">
          {slot.state === 'error' ? (
            <span className="text-caution">{slot.message}</span>
          ) : result ? (
            <ResultNote result={result} labels={labels} />
          ) : null}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRun}
          disabled={disabled}
          aria-label={`${labels.run}: ${copy.title}`}
        >
          <PlayIcon width={12} height={12} />
          {running ? labels.running : labels.run}
        </Button>
      </footer>
    </Card>
  );
}

function ResultNote({ result, labels }: { result: AttackResult; labels: AttackLabLabels }) {
  switch (result.verdict) {
    case 'refused':
      return <>{fill(labels.refusedIn, { ms: result.elapsedMs })}</>;
    case 'held':
      return <>{fill(labels.heldIn, { ms: result.elapsedMs })}</>;
    case 'breached':
      return <span className="text-negative">{labels.breachedNote}</span>;
    case 'unavailable':
      return <>{labels.unavailableNote}</>;
  }
}

function Verdict({ verdict, labels }: { verdict: AttackVerdict; labels: AttackLabLabels }) {
  const [text, tone, Icon] =
    verdict === 'refused'
      ? [labels.verdictRefused, 'bg-positive-soft text-positive', ShieldIcon]
      : verdict === 'held'
        ? [labels.verdictHeld, 'bg-positive-soft text-positive', ShieldIcon]
        : verdict === 'breached'
          ? [labels.verdictBreached, 'bg-negative-soft text-negative', CrossIcon]
          : [labels.verdictUnavailable, 'bg-surface-sunken text-ink-secondary', AlertIcon];
  return (
    <span
      className={cn(
        'animate-verdict-in inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone,
      )}
    >
      <Icon width={13} height={13} />
      {text}
    </span>
  );
}

function Terminal({
  label,
  running,
  children,
}: {
  label: string;
  running: boolean;
  children: ReactNode;
}) {
  return (
    <figure className="bg-terminal text-terminal-ink relative mx-4 my-3 overflow-hidden rounded-lg sm:mx-5">
      <figcaption className="border-terminal-line text-terminal-muted flex items-center gap-2 border-b px-3 py-1.5 text-[11px]">
        <span className="flex gap-1" aria-hidden="true">
          <span className="bg-terminal-line size-2 rounded-full" />
          <span className="bg-terminal-line size-2 rounded-full" />
          <span className="bg-terminal-line size-2 rounded-full" />
        </span>
        {label}
      </figcaption>
      {running ? (
        <span
          aria-hidden="true"
          className="bg-terminal-keyword/70 animate-scan absolute top-[1.9rem] left-0 h-px w-1/3"
        />
      ) : null}
      <div className="overflow-x-auto px-3 py-3 font-mono text-[11.5px] leading-relaxed">
        {children}
      </div>
    </figure>
  );
}

const KEYWORDS =
  /\b(?:INSERT|INTO|VALUES|UPDATE|SET|WHERE|DELETE|FROM|SELECT|LIMIT|CONSTRAINTS|ALL|IMMEDIATE)\b/u;
const TOKENS = /(--[^\n]*|'(?:[^']|'')*'|\b[A-Z]{3,}\b)/gu;

/**
 * Just enough highlighting to read SQL at a glance: keywords, literals and
 * comments. Not a parser — the statements come from one module and use a
 * handful of shapes, and a real highlighter would ship a grammar for every
 * dialect to colour nine of them.
 */
function Sql({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKENS).map((part, position) => {
        if (part.startsWith('--')) {
          return (
            <span key={position} className="text-terminal-muted italic">
              {part}
            </span>
          );
        }
        if (part.startsWith("'")) {
          return (
            <span key={position} className="text-terminal-string">
              {part}
            </span>
          );
        }
        if (KEYWORDS.test(part)) {
          return (
            <span key={position} className="text-terminal-keyword">
              {part}
            </span>
          );
        }
        return part;
      })}
    </>
  );
}
