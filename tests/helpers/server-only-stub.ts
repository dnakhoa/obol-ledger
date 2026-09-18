/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * `server-only` resolves to a module that throws unless the bundler is applying
 * React's server condition. Aliasing it here lets the integration suite import
 * the real route modules — the point of those tests being that the wiring
 * between HTTP, services and Postgres is exercised, not re-implemented.
 */
export {};
