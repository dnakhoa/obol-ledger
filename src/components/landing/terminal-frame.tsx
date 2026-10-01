import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ReplyLine, ReplyTone } from './terminal-timeline';

/**
 * A psql window, and the two kinds of line it prints.
 *
 * Shared by every terminal on the landing page — the hero's, the balance
 * check's, the proofs' — so they read as one session rather than three
 * lookalikes. No `'use client'`: it holds no state, so it renders on the
 * server where a Server Component uses it and inside the bundle where a
 * Client Component does.
 */
export function TerminalFrame({
  title,
  toolbar,
  className,
  children,
}: {
  title: string;
  /** Controls for the window's title bar, such as a pause button. */
  toolbar?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'bg-terminal text-terminal-ink ring-terminal-line overflow-hidden rounded-xl font-mono text-[12.5px] leading-relaxed ring-1',
        className,
      )}
    >
      <div className="border-terminal-line flex h-10 items-center gap-3 border-b px-4">
        <span aria-hidden="true" className="flex shrink-0 gap-1.5">
          <span className="bg-terminal-line size-2.5 rounded-full" />
          <span className="bg-terminal-line size-2.5 rounded-full" />
          <span className="bg-terminal-line size-2.5 rounded-full" />
        </span>
        <p className="text-terminal-muted min-w-0 truncate text-[11px]">{title}</p>
        {toolbar ? <div className="ml-auto flex shrink-0 items-center">{toolbar}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A statement at the prompt, line by line.
 *
 * psql prints `=>` before the first line and `->` before each continuation,
 * which is the only way to tell from a screenshot where a statement starts.
 */
export function PromptLines({ text, caret = false }: { text: string; caret?: boolean }) {
  const lines = text.split('\n');
  return (
    <div className="break-words whitespace-pre-wrap">
      {lines.map((line, index) => (
        <div key={index}>
          <span aria-hidden="true" className="text-terminal-muted select-none">
            {index === 0 ? 'obol=> ' : 'obol-> '}
          </span>
          <span className="text-terminal-keyword">{line}</span>
          {caret && index === lines.length - 1 ? <Caret /> : null}
        </div>
      ))}
    </div>
  );
}

const TONES: Record<ReplyTone, string> = {
  error: 'text-terminal-error font-medium',
  detail: 'text-terminal-error/85',
  muted: 'text-terminal-muted',
  ok: 'text-terminal-ok font-medium',
};

export function ReplyLines({ lines }: { lines: readonly ReplyLine[] }) {
  return (
    <div className="break-words whitespace-pre-wrap">
      {lines.map((line, index) => (
        <div key={index} className={TONES[line.tone]}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

function Caret() {
  return (
    <span
      aria-hidden="true"
      className="animate-caret bg-terminal-ink ml-px inline-block h-[1.15em] w-[0.55em] translate-y-[0.2em]"
    />
  );
}
