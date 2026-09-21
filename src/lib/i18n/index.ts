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
