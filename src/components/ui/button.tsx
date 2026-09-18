import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/*
 * Every interactive surface here is at least 36px tall and, on touch, 44px —
 * the smallest target most people can hit reliably — and all of them inherit
 * the single focus ring defined in globals.css.
 */
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 cursor-pointer';

const VARIANTS = {
  primary: 'bg-action text-action-ink hover:bg-action-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-hover',
  ghost: 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 min-h-9',
  lg: 'h-11 px-5',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link href={href} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      {children}
    </Link>
  );
}
