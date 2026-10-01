'use client';

import { useEffect, useState } from 'react';
import { PauseIcon, PlayIcon } from '@/components/icons';
import { PromptLines, ReplyLines, TerminalFrame } from './terminal-frame';
import { REFUSALS } from './refusal-script';
import { advance, opening, type Exchange, type TerminalState } from './terminal-timeline';
import { useOnScreen, usePrefersReducedMotion } from './use-motion';

/**
 * The hero: a psql session trying to corrupt the ledger, and Postgres saying no.
 *
 * Plays only while it is on screen and until the visitor pauses it — moving
 * content that runs on by itself needs a way to stop it (WCAG 2.2.2). A
 * visitor who asked for reduced motion gets the whole session at once, as
 * text. Either way, a screen reader is given that same transcript rather than
 * a stream of single characters.
 */
export function RefusalTerminal({
  labels,
}: {
  labels: {
    readonly title: string;
    readonly pause: string;
    readonly play: string;
    readonly transcript: string;
  };
}) {
  const reduced = usePrefersReducedMotion();
  const [onScreen, observe] = useOnScreen<HTMLDivElement>();
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState<TerminalState>(() => opening(REFUSALS));
  const running = onScreen && !paused && !reduced;

  // The one timer. `advance` decides what comes next and when; this only
  // keeps a clock in step with it, which is what an effect is for.
  useEffect(() => {
    if (!running) return;
    const { next, after } = advance(state, REFUSALS);
    const timer = window.setTimeout(() => setState(next), after);
    return () => window.clearTimeout(timer);
  }, [state, running]);

  const toolbar = reduced ? null : (
    <button
      type="button"
      onClick={() => setPaused((was) => !was)}
      aria-label={paused ? labels.play : labels.pause}
      title={paused ? labels.play : labels.pause}
      className="text-terminal-muted hover:text-terminal-ink -mr-2 flex size-9 cursor-pointer items-center justify-center rounded-md transition-colors duration-150"
    >
      {paused ? <PlayIcon width={13} height={13} /> : <PauseIcon width={13} height={13} />}
    </button>
  );

  return (
    <TerminalFrame
      title={labels.title}
      toolbar={toolbar}
      className="shadow-[0_40px_120px_-40px_var(--brand-glow)]"
    >
      <div ref={observe} className="relative h-[22rem] sm:h-[24rem]">
        {reduced ? (
          <div className="h-full overflow-y-auto p-4 sm:p-5">
            <Transcript label={labels.transcript} exchanges={REFUSALS} />
          </div>
        ) : (
          <>
            {/*
              Bottom-anchored and clipped, like a real terminal: new lines push
              old ones up and out, and the fade says there was more above.
            */}
            <div
              aria-hidden="true"
              className="flex h-full flex-col justify-end gap-4 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_22%)] p-4 sm:p-5"
            >
              <Screen state={state} />
            </div>
            <div className="sr-only">
              <Transcript label={labels.transcript} exchanges={REFUSALS} />
            </div>
          </>
        )}
      </div>
    </TerminalFrame>
  );
}

/** Every exchange up to the current one; the current one as far as it has got. */
function Screen({ state }: { state: TerminalState }) {
  return REFUSALS.slice(0, state.exchange + 1).map((exchange, index) => {
    const current = index === state.exchange;
    const typing = current && state.phase === 'typing';
    return (
      <div key={index} className="space-y-1">
        <PromptLines
          text={current ? exchange.statement.slice(0, state.typed) : exchange.statement}
          caret={typing}
        />
        {typing ? null : <ReplyLines lines={exchange.reply} />}
      </div>
    );
  });
}

function Transcript({ label, exchanges }: { label: string; exchanges: readonly Exchange[] }) {
  return (
    <ol aria-label={label} className="space-y-4">
      {exchanges.map((exchange, index) => (
        <li key={index} className="space-y-1">
          <PromptLines text={exchange.statement} />
          <ReplyLines lines={exchange.reply} />
        </li>
      ))}
    </ol>
  );
}
