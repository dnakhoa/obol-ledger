import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Form controls with their label, hint and error wired together.
 *
 * The connective tissue is the point. A visible `<label>` that is actually
 * associated with its control, a hint referenced by `aria-describedby`, and an
 * error that is *also* referenced there rather than being colour-only, are what
 * make a form usable by someone who cannot see it — and they are exactly the
 * details that get skipped when every form hand-rolls its markup.
 */
const CONTROL =
  'w-full rounded-lg border bg-surface px-3 text-sm transition-colors duration-150 placeholder:text-ink-muted disabled:opacity-50 h-9';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="text-ink-secondary block text-xs font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-ink-muted text-[11px]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-negative text-[11px] font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const parts = [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function Input({
  invalid,
  className,
  ...props
}: ComponentPropsWithoutRef<'input'> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, invalid ? 'border-negative' : 'border-line', className)}
      {...props}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'select'> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        'cursor-pointer appearance-none bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat pr-8',
        invalid ? 'border-negative' : 'border-line',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * The error summary shown after a failed submit.
 *
 * Inline errors alone are not enough: on a long form the first invalid field
 * can be off-screen, so a summary at the top says what went wrong and links to
 * each field. It takes focus on failure, which is how a screen-reader user
 * learns the submit did not go through.
 */
export function ErrorSummary({
  id,
  title,
  errors,
}: {
  id: string;
  title: string;
  errors: readonly { field: string; message: string }[];
}) {
  return (
    <div
      id={id}
      role="alert"
      tabIndex={-1}
      className="border-negative bg-negative-soft rounded-lg border px-4 py-3"
    >
      <p className="text-negative text-sm font-medium">{title}</p>
      {errors.length > 0 ? (
        <ul className="text-negative mt-1.5 space-y-1 text-xs">
          {errors.map((error) => (
            <li key={`${error.field}-${error.message}`}>
              <a href={`#${error.field.replaceAll('.', '-')}`} className="underline">
                {error.field === 'form' ? error.message : `${error.field}: ${error.message}`}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
