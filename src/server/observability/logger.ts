/**
 * Structured logging, one JSON object per line.
 *
 * Serverless platforms collect stdout and index it, so the useful thing a log
 * line can be is machine-queryable: `level`, `event` and a request id on every
 * line means "show me every failed request in the last hour" is a filter rather
 * than a regular expression. A logging library would add a dependency and a
 * bundle cost for behaviour this small, so it is written out here.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = process.env['LOG_LEVEL'];
  return raw && raw in LEVEL_ORDER ? (raw as LogLevel) : 'info';
}

export type LogFields = Record<string, unknown>;

export type Logger = {
  readonly debug: (event: string, fields?: LogFields) => void;
  readonly info: (event: string, fields?: LogFields) => void;
  readonly warn: (event: string, fields?: LogFields) => void;
  readonly error: (event: string, fields?: LogFields) => void;
  /** Returns a logger that stamps every line with the given fields. */
  readonly child: (bindings: LogFields) => Logger;
};

/**
 * An `Error` does not survive `JSON.stringify` — it serialises to `{}`. Pulling
 * the useful parts out explicitly is the difference between a log line that
 * explains an outage and one that says nothing.
 */
function serializeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    ...(value.cause === undefined ? {} : { cause: serializeError(value.cause) }),
  };
}

function normalize(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, serializeError(value)]),
  );
}

export function createLogger(bindings: LogFields = {}): Logger {
  const threshold = LEVEL_ORDER[configuredLevel()];

  function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = JSON.stringify({
      level,
      event,
      time: new Date().toISOString(),
      ...normalize(bindings),
      ...normalize(fields),
    });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({ service: 'obol-ledger' });
