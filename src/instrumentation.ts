import { registerOTel } from '@vercel/otel';

/**
 * OpenTelemetry, registered before anything else runs.
 *
 * Next.js calls this once per runtime at startup, which is the only point
 * early enough to patch the libraries that need instrumenting. Vercel's
 * wrapper is used rather than assembling an SDK by hand because it already
 * wires the exporter to whatever collector the platform provides — and falls
 * back to a no-op locally, so a developer without a collector pays nothing.
 *
 * The spans that matter here are named in `src/server/observability/tracing.ts`.
 * Automatic HTTP and database spans tell you a request was slow; they cannot
 * tell you *which invariant* was being enforced when it was.
 */
export function register(): void {
  registerOTel({ serviceName: 'obol-ledger' });
}
