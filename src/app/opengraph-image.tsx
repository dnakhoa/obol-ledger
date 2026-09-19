import { ImageResponse } from 'next/og';

/**
 * The card that appears when a link to this project is shared.
 *
 * Generated rather than committed as a PNG: the copy lives next to the code, so
 * it cannot describe a previous version of the project, and there is no binary
 * in the repository to keep in sync by hand. Next renders it once at build time.
 */
export const alt = 'Obol Ledger — a correctness-first double-entry ledger';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0b0f1a',
        padding: 72,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0b0f1a"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6h6ZM19 8l-3 6h6Z" />
          </svg>
        </div>
        <div style={{ fontSize: 30, color: '#f8fafc', letterSpacing: -0.5 }}>Obol Ledger</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div
          style={{
            fontSize: 62,
            color: '#f8fafc',
            letterSpacing: -2,
            lineHeight: 1.08,
            maxWidth: 940,
          }}
        >
          A ledger the database refuses to let you corrupt
        </div>
        <div style={{ fontSize: 27, color: '#94a3b8', lineHeight: 1.4, maxWidth: 860 }}>
          Double-entry accounting with the balance rule enforced by a deferred Postgres constraint,
          exact integer money, and idempotent writes.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14 }}>
        {['Next.js 16', 'Postgres + Drizzle', 'RFC 9457 errors', '199 tests'].map((chip) => (
          <div
            key={chip}
            style={{
              fontSize: 21,
              color: '#cbd5e1',
              border: '1px solid #27303f',
              borderRadius: 999,
              padding: '10px 22px',
            }}
          >
            {chip}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
