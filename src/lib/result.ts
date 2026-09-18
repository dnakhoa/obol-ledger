/**
 * A minimal `Result` type.
 *
 * Domain failures in this codebase are *expected outcomes*, not exceptions:
 * "this transaction does not balance" is as much a result as "here is the
 * transaction id". Returning them keeps them in the type signature, so a caller
 * cannot forget to handle one. Exceptions remain reserved for genuinely
 * exceptional conditions (a dropped connection, a bug), which is exactly what
 * the top-level HTTP handler turns into a 500.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Applies `fn` to the success value, leaving an error untouched. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Collects a list of results into a result of a list, short-circuiting on the
 * first error. Used to validate every posting in a transaction while reporting
 * the first thing that is wrong.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Escape hatch for call sites that have already proven the result is `Ok`
 * (seed scripts, tests). Throws loudly rather than silently returning a
 * fallback, so a broken assumption surfaces immediately.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap() called on an Err: ${JSON.stringify(result.error)}`);
}
