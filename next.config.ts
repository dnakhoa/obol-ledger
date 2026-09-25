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
        ],
      },
    ];
  },
};

export default nextConfig;
