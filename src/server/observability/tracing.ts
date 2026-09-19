import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

/**
 * Domain-level tracing.
 *
 * Automatic instrumentation gives you an HTTP span and a database span. That
 * answers "was the request slow" and "was the query slow", and neither answers
 * the question you actually have at 3am, which is *what was the system doing*.
 *
 * A span named `ledger.post_entry` carrying the tenant, the entry's status and
 * the number of postings turns a latency graph into an explanation. The
 * attributes are chosen to be safe to export: ids and counts, never amounts or
 * descriptions, because a trace backend is a third-party system and a ledger's
 * figures are its most sensitive data.
 */
const tracer = trace.getTracer('obol-ledger');

export type SpanAttributes = Record<string, string | number | boolean>;

/**
 * Runs `work` inside a span, recording failures on the span before rethrowing.
 *
 * Errors are recorded rather than swallowed: a span that ends `OK` while the
 * operation threw is worse than no span at all, because it makes the trace
 * lie in exactly the situation you are consulting it about.
 */
export async function traced<T>(
  name: string,
  attributes: SpanAttributes,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await work(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'unknown error',
      });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Marks a span with a *business* outcome.
 *
 * A rejected entry is not an error — the system worked exactly as designed —
 * so the span stays `OK` and carries the reason as an attribute instead.
 * Recording domain refusals as exceptions would fill an error budget with
 * correct behaviour and train everyone to ignore it.
 */
export function recordOutcome(span: Span, outcome: string, reason?: string): void {
  span.setAttribute('ledger.outcome', outcome);
  if (reason) span.setAttribute('ledger.reason', reason);
}
