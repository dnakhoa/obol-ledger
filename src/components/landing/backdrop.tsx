/**
 * The light behind a section: a ledger-ruled grid fading out from the top,
 * and a gold glow where the coin would catch it.
 *
 * Pure decoration, so hidden from assistive technology and from the pointer.
 * The parent must establish a stacking context (`isolate`) for `-z-10` to sit
 * behind its content rather than behind the page.
 */
export function Backdrop({ glow = 'top' }: { glow?: 'top' | 'center' }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--line)_1px,transparent_1px),linear-gradient(to_bottom,var(--line)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black_30%,transparent_100%)] bg-[size:3.5rem_3.5rem] opacity-50" />
      {glow === 'top' ? (
        <>
          <div className="bg-brand-glow absolute -top-48 left-1/2 h-[34rem] w-[min(64rem,140vw)] -translate-x-1/2 rounded-full blur-3xl" />
          <div className="bg-series-wash absolute top-24 -right-40 size-[28rem] rounded-full blur-3xl" />
        </>
      ) : (
        <div className="bg-brand-glow absolute top-1/2 left-1/2 h-[28rem] w-[min(56rem,140vw)] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl" />
      )}
    </div>
  );
}
