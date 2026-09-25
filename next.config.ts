import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Next writes AGENTS.md/CLAUDE.md on dev start; this repo documents itself in
  // README.md and docs/, so the generated copies are noise in the diff.
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // `pg` opens raw TCP sockets and loads native-ish internals; it has to stay a
  // real Node module rather than being traced and bundled by the compiler.
  serverExternalPackages: ['pg'],
  experimental: {
    // A scanned invoice or customs declaration, up to the 4 MiB the document
    // store accepts, plus the form around it. Server Actions default to 1 MB,
    // which refused an ordinary phone photo of a receipt.
    serverActions: { bodySizeLimit: '5mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Browsers ignore this over plain HTTP, so it is safe to send from a
          // local `pnpm start`; over HTTPS it stops a first visit on a hostile
          // network being downgraded. Two years, the preload list's minimum.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // Pages get a per-request policy from `src/proxy.ts`, and documents
        // their own from the route that serves them. The API answers JSON and
        // needs nothing a policy could allow.
        source: '/api/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
