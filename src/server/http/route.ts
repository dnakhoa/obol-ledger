import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createLogger, type Logger } from '@/server/observability/logger';
import { authorize } from './auth';
import { rateLimit, rateLimitProblem } from './rate-limit';
import { problem, problemResponse } from './problem';

/**
 * The shared behaviour of every API route, applied once.
 *
 * A route handler should contain the thing that makes it different from the
 * others. Correlation ids, access logging, authentication, rate limiting, and
 * turning an unexpected throw into a well-formed 500 are the same everywhere,
 * so they live here — which also means they cannot be forgotten on the one
 * endpoint nobody reviewed carefully.
 */

export type RouteContext<Params> = {
  readonly request: Request;
  readonly params: Params;
  readonly requestId: string;
  readonly logger: Logger;
};

export type RouteOptions = {
  /** Used as the log `event` and to identify the route in traces. */
  readonly name: string;
  /** Write endpoints require a bearer token; reads are public. */
  readonly auth?: boolean;
  readonly rateLimit?: boolean;
};

type NextContext<Params> = { params: Promise<Params> };

export function defineRoute<Params = Record<string, never>>(
  options: RouteOptions,
  handler: (context: RouteContext<Params>) => Promise<Response>,
): (request: Request, context: NextContext<Params>) => Promise<Response> {
  return async (request, context) => {
    // Honour an inbound correlation id so a trace survives across services,
    // and mint one otherwise so every response can be tied back to its logs.
    const requestId = request.headers.get('x-request-id') ?? randomUUID();
    const log = createLogger({ service: 'obol-ledger', route: options.name, requestId });
    const startedAt = performance.now();

    const finish = (response: Response): Response => {
      const headers = new Headers(response.headers);
      headers.set('x-request-id', requestId);
      log.info('request.completed', {
        method: request.method,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    try {
      if (options.rateLimit !== false) {
        const decision = rateLimit(clientKey(request));
        if (!decision.allowed) {
          return finish(
            problemResponse(
              { ...rateLimitProblem(decision), requestId },
              {
                'retry-after': String(decision.retryAfterSeconds),
              },
            ),
          );
        }
      }

      if (options.auth) {
        const rejection = authorize(request);
        if (rejection) return finish(problemResponse({ ...rejection, requestId }));
      }

      const params = await context.params;
      return finish(await handler({ request, params, requestId, logger: log }));
    } catch (error) {
      // Anything reaching here is a bug or an outage, never a business outcome.
      // The client gets a correlation id; the details stay in the logs.
      log.error('request.failed', { method: request.method, error });
      return finish(
        problemResponse({
          ...problem(
            500,
            'internal-error',
            'Internal server error',
            'The request could not be completed. Quote the request id when reporting this.',
          ),
          requestId,
        }),
      );
    }
  };
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

export function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Ledger data is per-request and must never be served from a shared cache.
      'cache-control': 'no-store',
      ...init.headers,
    },
  });
}

/**
 * Parses and validates a JSON body, returning the raw value alongside it so the
 * caller can fingerprint exactly what the client sent for idempotency.
 */
export async function readJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  requestId: string,
): Promise<{ ok: true; data: z.infer<Schema>; raw: unknown } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: problemResponse({
        ...problem(400, 'malformed-json', 'Malformed JSON', 'The request body is not valid JSON.'),
        requestId,
      }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: validationProblem(parsed.error, requestId) };
  }

  return { ok: true, data: parsed.data, raw };
}

export function validationProblem(error: z.ZodError, requestId: string): Response {
  return problemResponse({
    ...problem(
      400,
      'validation-failed',
      'Request validation failed',
      'One or more fields are invalid. See `errors` for the specifics.',
      {
        // Flattened to `field -> messages`, which is directly usable by a form.
        errors: error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
          code: issue.code,
        })),
      },
    ),
    requestId,
  });
}

export function parseQuery<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  requestId: string,
): { ok: true; data: z.infer<Schema> } | { ok: false; response: Response } {
  const { searchParams } = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(searchParams));
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, response: validationProblem(parsed.error, requestId) };
}

export function unprocessable(
  requestId: string,
  detail: string,
  extensions: Record<string, unknown> = {},
): Response {
  return problemResponse({
    ...problem(422, 'unprocessable-amount', 'Amount could not be interpreted', detail, extensions),
    requestId,
  });
}
