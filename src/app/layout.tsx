import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { viewerLocale } from '@/server/i18n';

/**
 * Fonts are self-hosted by `next/font`: it downloads them at build time and
 * serves them from our own origin, which removes a third-party connection from
 * the critical path and lets the CSS carry the exact metrics needed to avoid a
 * layout shift when the face swaps in.
 */
const inter = Inter({
  // `vietnamese` as well as `latin`, which is not optional once the interface
  // speaks Vietnamese: without it every ề, ữ and ợ falls out of Inter and is
  // painted by a system fallback, so a Vietnamese sentence renders in two
  // typefaces at two weights. It costs one more subset file, fetched only by
  // browsers that need it.
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
  variable: '--font-inter',
});

const mono = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-mono-face',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://obol-ledger.vercel.app'),
  title: {
    default: 'Obol Ledger',
    template: '%s · Obol Ledger',
  },
  description:
    'A correctness-first double-entry ledger. Balanced by construction, append-only, and enforced by Postgres as well as the application.',
  openGraph: {
    title: 'Obol Ledger',
    description: 'A correctness-first double-entry ledger with a typed HTTP API.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximum-scale: capping zoom breaks the page for anyone who needs it.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#12151f' },
  ],
};

/**
 * Resolves the theme *before* the first paint.
 *
 * Without this, the document renders with the default theme and then corrects
 * itself once React hydrates — a white flash on every cold load for anyone who
 * chose dark. It has to be inline and synchronous in `<head>`, because that is
 * the only thing that runs before the browser paints.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('obol-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = resolved;
  } catch (_) {
    document.documentElement.dataset.theme = 'light';
  }
})();
`.trim();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // `lang` is not decoration: it picks the hyphenation and line-breaking rules,
  // tells a screen reader which voice to use, and is what a translation tool
  // reads before offering to translate a page that is already translated.
  const locale = await viewerLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
