import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Status is carried by the *word*, with colour as reinforcement.
 *
 * Account type is shown in neutral ink rather than a hue per type: five
 * categorical colours cannot be told apart under deuteranopia (blue and violet
 * came back at a ΔE of 0.4), and a label already says "Liability" unambiguously.
 * Colour is reserved for the two distinctions a reader acts on — whether the
 * books balance, and which way money moved.
 */
const TONES = {
  neutral: 'border-line bg-surface-sunken text-ink-secondary',
  positive: 'border-transparent bg-positive-soft text-positive',
  negative: 'border-transparent bg-negative-soft text-negative',
  caution: 'border-transparent bg-caution-soft text-caution',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
