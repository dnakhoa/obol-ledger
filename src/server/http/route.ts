import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createLogger, type Logger } from '@/server/observability/logger';
import { authenticate, type Authenticated } from './auth';
import { servicesFor, type Services } from '@/server/container';
import { rateLimitProblem } from './rate-limit';
import { durableRateLimit } from './durable-rate-limit';
import { MAX_JSON_BYTES, readBody } from './body';
import { clientAddress } from './client-address';
import { db } from '@/server/db/client';
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
  /** The tenant this request acts as. Never absent — see `http/auth.ts`. */
  readonly orgId: string;
  /** Services already bound to that tenant, so a handler cannot forget to. */
  readonly services: Services;
};

export type RouteOptions = {
  /** Used as the log `event` and to identify the route in traces. */
  readonly name: string;
  /** Write endpoints require a bearer token; reads act as the demo tenant. */
  readonly auth?: boolean;
  readonly rateLimit?: boolean;
  /** Opt out of tenant resolution entirely — only `/health` and the spec. */
  readonly tenantless?: boolean;
};

type NextContext<Params> = { params: Promise<Params> };

export function defineRoute<Params = Record<string, never>>(
  options: RouteOptions,
  handler: (context: RouteContext<Params>) => Promise<Response>,
): (request: Request, context: NextContext<Params>) => Promise<Response> {
  return async (request, context) => {
    // Honour an inbound correlation id so a trace survives across services,
    // and mint one otherwise so every response can be tied back to its logs.
    // Only an id that looks like one: this is echoed back and written to
    // every log line, so it is not a place for a client's kilobyte of text.
    const inbound = request.headers.get('x-request-id');
    const requestId = inbound && /^[\w.:-]{1,128}$/u.test(inbound) ? inbound : randomUUID();
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
        // Counted in Postgres so every instance shares one quota, with the
        // in-process window kept as a pre-check that can only reject. If the
        // counter is unreachable the decision degrades to that local answer
        // rather than refusing everything — see `durable-rate-limit.ts`.
        const decision = await durableRateLimit(db(), clientKey(request));
        if (decision.degraded) log.warn('ratelimit.degraded', { key: options.name });
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

      // Tenant resolution happens for every route that touches the ledger, so
      // a handler is handed services that are already scoped and cannot reach
      // another tenant's rows even by mistake.
      let identity: Authenticated = { orgId: '' };
      if (!options.tenantless) {
        const resolved = await authenticate(request, options.auth === true);
        if ('status' in resolved) {
          return finish(problemResponse({ ...resolved, requestId }));
        }
        identity = resolved;
      }

      const params = await context.params;
      return finish(
        await handler({
          request,
          params,
          requestId,
          logger: identity.principal
            ? log.child({ orgId: identity.orgId, apiKeyId: identity.principal.apiKeyId })
            : log.child({ orgId: identity.orgId }),
          orgId: identity.orgId,
          services: servicesFor(identity.orgId),
        }),
      );
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
  return clientAddress(request.headers);
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
  const body = await readBody(request, MAX_JSON_BYTES);
  if (body === 'too_large') {
    return {
      ok: false,
      response: problemResponse({
        ...problem(
          413,
          'body-too-large',
          'Request body too large',
          `A JSON body may be at most ${MAX_JSON_BYTES / 1024} KB.`,
        ),
        requestId,
      }),
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
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
