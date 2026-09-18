import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/server/observability/logger';

function captureStdout() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
  return { lines, restore: () => spy.mockRestore() };
}

function captureStderr() {
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, 'error')
    .mockImplementation((line: string) => void lines.push(line));
  return { lines, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['LOG_LEVEL'];
});

describe('structured logger', () => {
  it('emits one JSON object per line', () => {
    const { lines, restore } = captureStdout();
    createLogger({ service: 'test' }).info('thing.happened', { count: 3 });
    restore();

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'info',
      event: 'thing.happened',
      service: 'test',
      count: 3,
    });
    expect(typeof record['time']).toBe('string');
  });

  it('sends warnings and errors to stderr, everything else to stdout', () => {
    const out = captureStdout();
    const err = captureStderr();
    const logger = createLogger();
    logger.info('routine');
    logger.warn('suspicious');
    logger.error('broken');
    out.restore();
    err.restore();

    expect(out.lines).toHaveLength(1);
    expect(err.lines).toHaveLength(2);
  });

  it('serialises an Error, which JSON.stringify turns into {}', () => {
    const { lines, restore } = captureStderr();
    const cause = new Error('connection reset');
    createLogger().error('request.failed', { error: new Error('query failed', { cause }) });
    restore();

    const record = JSON.parse(lines[0] ?? '{}') as {
      error: { message: string; stack: string; cause: { message: string } };
    };
    expect(record.error.message).toBe('query failed');
    expect(record.error.stack).toContain('Error');
    expect(record.error.cause.message).toBe('connection reset');
  });

  it('stamps child bindings onto every line', () => {
    const { lines, restore } = captureStdout();
    createLogger({ service: 'ledger' }).child({ requestId: 'abc' }).info('request.completed');
    restore();

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ service: 'ledger', requestId: 'abc' });
  });

  it('honours LOG_LEVEL', () => {
    process.env['LOG_LEVEL'] = 'warn';
    const out = captureStdout();
    const err = captureStderr();
    const logger = createLogger();
    logger.debug('noise');
    logger.info('noise');
    logger.warn('kept');
    out.restore();
    err.restore();

    expect(out.lines).toHaveLength(0);
    expect(err.lines).toHaveLength(1);
  });

  it('falls back to info for an unrecognised LOG_LEVEL', () => {
    process.env['LOG_LEVEL'] = 'chatty';
    const { lines, restore } = captureStdout();
    const logger = createLogger();
    logger.debug('dropped');
    logger.info('kept');
    restore();

    expect(lines).toHaveLength(1);
  });
});
