/**
 * The landing terminal's clock, as a pure function.
 *
 * The component that draws the terminal owns one timer and asks this module
 * two questions: what comes after the frame on screen, and how long to hold
 * it. Keeping the answers out of React means the pacing is tested by handing
 * it a state rather than by waiting on a browser, and the component cannot
 * grow a second timer that drifts against the first.
 */

export type ReplyTone = 'error' | 'detail' | 'muted' | 'ok';

export type ReplyLine = { readonly tone: ReplyTone; readonly text: string };

/** One statement typed at the prompt, and what Postgres printed back. */
export type Exchange = { readonly statement: string; readonly reply: readonly ReplyLine[] };

export type TerminalState = {
  /** Index into the script of the exchange being typed or answered. */
  readonly exchange: number;
  /** Characters of its statement on screen. */
  readonly typed: number;
  readonly phase: 'typing' | 'replied';
};

/** Milliseconds. Typing is quick enough to watch and slow enough to read. */
export const PACE = {
  keystroke: 18,
  /** Postgres "thinking": long enough that the reply reads as a response. */
  think: 420,
  /** How long a refusal stays up before the next attack is typed. */
  read: 2600,
} as const;

/**
 * The most keystrokes a statement takes to type. A longer one types several
 * characters a stroke instead, so a complete multi-line attack takes about
 * as long to watch (~2 s) as a one-line one, rather than four times as long.
 */
export const TYPING_TICKS = 110;

/**
 * The first frame: the first exchange already answered.
 *
 * Server-rendered as it is, so the terminal says something before any script
 * has loaded — and to anyone for whom it never will.
 */
export function opening(script: readonly Exchange[]): TerminalState {
  return { exchange: 0, typed: script[0]?.statement.length ?? 0, phase: 'replied' };
}

export function advance(
  state: TerminalState,
  script: readonly Exchange[],
): { readonly next: TerminalState; readonly after: number } {
  const length = script[state.exchange]?.statement.length ?? 0;

  if (state.phase === 'replied') {
    // Wrapping to the start is how the screen "clears": the component shows
    // only the exchanges before the current one, and there are none before 0.
    const exchange = (state.exchange + 1) % Math.max(script.length, 1);
    return { next: { exchange, typed: 0, phase: 'typing' }, after: PACE.read };
  }
  if (state.typed < length) {
    const stroke = Math.max(1, Math.ceil(length / TYPING_TICKS));
    return {
      next: { ...state, typed: Math.min(state.typed + stroke, length) },
      after: PACE.keystroke,
    };
  }
  return { next: { ...state, phase: 'replied' }, after: PACE.think };
}
