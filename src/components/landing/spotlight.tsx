'use client';

import type { PointerEvent, ReactNode } from 'react';

/**
 * A soft light that follows the pointer across a grid of cards.
 *
 * One listener on the grid instead of one island per card: the cards stay
 * Server Components, and this writes two custom properties onto whichever
 * card is under the pointer. The card's own CSS (`SpotlightCard`) draws the
 * light, so nothing re-renders as the pointer moves. A touch screen has no
 * hover and simply never sees it, which costs that visitor nothing.
 */
export function Spotlight({ className, children }: { className?: string; children: ReactNode }) {
  function follow(event: PointerEvent<HTMLDivElement>) {
    const card = (event.target as Element).closest<HTMLElement>('[data-spotlight]');
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
    card.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
  }

  return (
    <div className={className} onPointerMove={follow}>
      {children}
    </div>
  );
}
