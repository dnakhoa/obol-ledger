import type { ReactNode } from 'react';

/**
 * What a panel shows when there is genuinely nothing to show.
 *
 * An empty table with only headers reads as a bug. Saying what is missing and
 * offering the action that fills it turns a dead end into a next step.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-ink-muted max-w-sm text-xs">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
