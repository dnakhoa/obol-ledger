import { cn } from '@/lib/cn';

/** Where the beam turns, and how far each pan hangs from it, in SVG units. */
const PIVOT = { x: 130, y: 34 } as const;
const ARM = 92;

/** A little past the target, then settling: how a real beam comes to rest. */
const SWING = 'transition-transform duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]';

/**
 * A two-pan balance, tilted by `angle` degrees.
 *
 * Presentational only: the angle is worked out by `tilt()` and handed in.
 * The beam rotates about its pivot; the pans do not rotate with it — a pan
 * hangs plumb — they move straight up or down by the height the beam's end
 * moved, which is what keeps them reading as weights rather than as a
 * rotated picture. Only `transform` animates, so the swing is composited
 * rather than laid out.
 */
export function BalanceScale({
  angle,
  balanced,
  label,
  sides,
}: {
  angle: number;
  balanced: boolean;
  label: string;
  sides: { readonly left: string; readonly right: string };
}) {
  const drop = ARM * Math.sin((angle * Math.PI) / 180);

  return (
    <svg viewBox="0 0 260 170" role="img" aria-label={label} className="mx-auto w-full max-w-xs">
      <g className="stroke-line-strong" strokeWidth={3} strokeLinecap="round" fill="none">
        <path d={`M${PIVOT.x} ${PIVOT.y}V152`} />
        <path d="M100 152h60" />
      </g>

      <g
        className={SWING}
        style={{
          transform: `rotate(${angle}deg)`,
          transformOrigin: `${PIVOT.x}px ${PIVOT.y}px`,
          transformBox: 'view-box',
        }}
      >
        <path
          d={`M${PIVOT.x - ARM} ${PIVOT.y}H${PIVOT.x + ARM}`}
          className="stroke-ink-secondary"
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      </g>

      <Pan x={PIVOT.x - ARM} drop={-drop} text={sides.left} />
      <Pan x={PIVOT.x + ARM} drop={drop} text={sides.right} />

      <circle
        cx={PIVOT.x}
        cy={PIVOT.y}
        r={7}
        className={cn(
          'transition-colors duration-300',
          balanced ? 'fill-positive' : 'fill-negative',
        )}
      />
      <circle cx={PIVOT.x} cy={PIVOT.y} r={2.5} className="fill-canvas" />
    </svg>
  );
}

function Pan({ x, drop, text }: { x: number; drop: number; text: string }) {
  return (
    <g className={SWING} style={{ transform: `translateY(${drop}px)` }}>
      <g className="stroke-line-strong" strokeWidth={1.5} fill="none">
        <path d={`M${x} ${PIVOT.y}L${x - 26} 84M${x} ${PIVOT.y}L${x + 26} 84`} />
      </g>
      <path
        d={`M${x - 32} 84Q${x} 114 ${x + 32} 84Z`}
        className="fill-surface-sunken stroke-line-strong"
        strokeWidth={1.5}
      />
      <text
        x={x}
        y={132}
        textAnchor="middle"
        className="fill-ink-muted font-mono text-[11px] tracking-wide uppercase"
      >
        {text}
      </text>
    </g>
  );
}
