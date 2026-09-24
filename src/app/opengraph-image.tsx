import { ImageResponse } from 'next/og';

/**
 * The card that appears when a link to this project is shared.
 *
 * Generated rather than committed as a PNG: the copy lives next to the code, so
 * it cannot describe a previous version of the project, and there is no binary
 * in the repository to keep in sync by hand. Next renders it once at build time.
 *
 * It says what `/break` shows, in the same order the page does: an attack, and
 * Postgres' answer. The chips name nothing that goes stale with every commit —
 * a test count on a card that is cached by every network it was shared to is a
 * number that is wrong within the week.
 */
export const alt =
  'Obol Ledger — balanced by construction, refused by Postgres. Three attacks on the ledger and the Postgres errors that refused them.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const REFUSALS = [
  {
    attack: 'DELETE FROM transactions WHERE …',
    code: '23001 restrict_violation',
    detail: 'transactions is append-only',
  },
  {
    attack: 'SET CONSTRAINTS ALL IMMEDIATE',
    code: '23514 check_violation',
    detail: 'unbalanced by 1 minor units',
  },
  {
    attack: "INSERT INTO accounts … 'org_OTHER'",
    code: '42501 insufficient_privilege',
    detail: 'violates row-level security',
  },
];

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: '#0d1017',
        padding: 64,
        gap: 40,
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: 580,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 13,
              background: '#f3f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0d1017"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6h6ZM19 8l-3 6h6Z" />
            </svg>
          </div>
          <div style={{ fontSize: 28, color: '#f3f5f9', letterSpacing: -0.5 }}>Obol Ledger</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 47,
              letterSpacing: -1.8,
              lineHeight: 1.08,
            }}
          >
            <span style={{ color: '#f3f5f9' }}>Balanced by construction.</span>
            <span style={{ color: '#8ea8ff' }}>Refused by Postgres.</span>
          </div>
          <div style={{ fontSize: 24, color: '#9aa3b5', lineHeight: 1.4 }}>
            A double-entry ledger whose every invariant lives in the database — and a live page that
            dares you to break it.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {['Postgres', 'Next.js', 'TypeScript', 'Row-level security'].map((chip) => (
            <div
              key={chip}
              style={{
                display: 'flex',
                whiteSpace: 'nowrap',
                fontSize: 19,
                lineHeight: 1,
                color: '#c7cede',
                border: '1px solid #2a3142',
                borderRadius: 999,
                padding: '10px 18px',
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          background: '#131722',
          border: '1px solid #262c3b',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 20px',
            background: '#1a1f2d',
            color: '#6f7890',
            fontSize: 17,
          }}
        >
          <div style={{ width: 11, height: 11, borderRadius: 99, background: '#2e3547' }} />
          <div style={{ width: 11, height: 11, borderRadius: 99, background: '#2e3547' }} />
          <div style={{ width: 11, height: 11, borderRadius: 99, background: '#2e3547' }} />
          <div style={{ marginLeft: 10 }}>psql as obol_app</div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            padding: '24px 24px 0',
            flex: 1,
          }}
        >
          {REFUSALS.map((refusal) => (
            <div key={refusal.code} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 19, color: '#d7dcea' }}>{`obol=> ${refusal.attack}`}</div>
              <div style={{ fontSize: 19, color: '#ff7b72' }}>{`ERROR: ${refusal.code}`}</div>
              <div style={{ fontSize: 18, color: '#f0a8a2', paddingLeft: 24 }}>
                {refusal.detail}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px 22px',
          }}
        >
          <div style={{ fontSize: 21, color: '#e9edf5', whiteSpace: 'nowrap' }}>
            9 of 9 attacks refused
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: 9 }, (_, index) => (
              <div
                key={index}
                style={{ width: 12, height: 8, borderRadius: 4, background: '#3fbf8a' }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
