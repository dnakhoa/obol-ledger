'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';

/**
 * Light / dark / system, as a three-way radio rather than a toggle.
 *
 * A two-state toggle cannot express "follow my operating system", which is what
 * most people want — and once it has been overridden there is no way back
 * without clearing site data.
 *
 * The preference is read with `useSyncExternalStore` rather than copied into
 * state inside an effect. `localStorage` *is* an external store: the hook knows
 * the server cannot read it (hence the server snapshot), subscribes for changes
 * so a second tab stays in step, and avoids the render-then-correct flicker
 * that the effect version has by construction. The stored value is replayed by
 * the blocking script in the root layout, so the first paint is already right.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'obol-theme';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

function isPreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Local subscribers: `storage` only fires in *other* tabs, never the one that wrote. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
    media.removeEventListener('change', onChange);
  };
}

function getSnapshot(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    // Private browsing and blocked storage both throw rather than return null.
    return 'system';
  }
}

/** The server has no preference to read, so it renders the neutral option. */
function getServerSnapshot(): ThemePreference {
  return 'system';
}

function applyToDocument(preference: ThemePreference): void {
  const resolved =
    preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
  document.documentElement.dataset['theme'] = resolved;
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const choose = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage being unavailable should not stop the theme from changing.
    }
    applyToDocument(next);
    for (const listener of listeners) listener();
  }, []);

  return (
    <fieldset className="border-line bg-surface-sunken flex items-center gap-0.5 rounded-lg border p-0.5">
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = preference === value;
        return (
          <label
            key={value}
            title={label}
            className={cn(
              'flex h-7 w-8 cursor-pointer items-center justify-center rounded-md transition-colors duration-150',
              selected
                ? 'bg-surface text-ink shadow-[var(--shadow-card)]'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={selected}
              onChange={() => choose(value)}
              className="sr-only"
            />
            <Icon />
            <span className="sr-only">{label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
