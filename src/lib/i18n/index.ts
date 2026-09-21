import { en, type Messages } from './messages/en';
import { vi } from './messages/vi';
import { ja } from './messages/ja';
import { DEFAULT_LOCALE, type Locale } from './locales';

export type { Messages } from './messages/en';
export * from './locales';

const MESSAGES: Record<Locale, Messages> = { en, vi, ja };

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
}

export * from './ledger';
export * from './account-class';
export * from './dates';
export * from './separators';
export * from './client';

/**
 * Fills `{name}` placeholders in a message.
 *
 * Exists because a message a Client Component has to format cannot be a
 * function: passing one across the server/client boundary throws
 * "Functions cannot be passed directly to Client Components", which is a
 * runtime error on the page rather than a build failure. So those messages
 * are templates, and the substitution happens where the value is known.
 *
 * Server Components have no such limit and keep using functions — they call
 * them before rendering, so only the finished string is ever sent.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replaceAll(/\{(\w+)\}/gu, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
