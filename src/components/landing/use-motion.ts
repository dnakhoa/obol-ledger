import { useCallback, useState, useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Whether the visitor asked their system for less motion.
 *
 * A subscription rather than a read in an effect, so a change made in system
 * settings while the page is open takes effect without a reload. The server
 * cannot know, and answers "no": what it renders is a still frame either way,
 * so a visitor who did ask sees no motion before the client corrects it.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/**
 * Whether an element is on screen, and the ref that reports it.
 *
 * A ref callback that returns its own cleanup — React 19's form — so the
 * observer lives exactly as long as the element, with no effect to keep in
 * step with it. An animation nobody can see is a timer waking a laptop for
 * nothing.
 */
export function useOnScreen<T extends Element>(): readonly [boolean, (node: T | null) => void] {
  const [onScreen, setOnScreen] = useState(false);
  const ref = useCallback((node: T | null) => {
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      setOnScreen(entry?.isIntersecting ?? false);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [onScreen, ref] as const;
}
