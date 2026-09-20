'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { LOCALE_COOKIE, isLocale } from '@/lib/i18n';

/**
 * Remembers a language choice, then returns to the page it was made on.
 *
 * A year, because a language preference does not go stale, and `lax` rather
 * than `strict` so arriving from an external link does not silently fall back
 * to the guessed language on the first page. It carries no identity and no
 * secret: the worst a forged value can do is show somebody their own
 * interface in the other language.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const value = String(formData.get('locale') ?? '');
  if (!isLocale(value)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });

  // Every page's text came from this cookie, so every page is now stale.
  revalidatePath('/', 'layout');

  // And then actually go there. Revalidation marks the server's cache stale;
  // it does not make a client that already holds a rendered payload ask for a
  // new one. Only an internal path is accepted — a `next` of `//evil.test`
  // would otherwise turn a preference toggle into an open redirect.
  const next = String(formData.get('next') ?? '/');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}
