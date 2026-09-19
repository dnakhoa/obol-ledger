/**
 * Raised when the application is configured but not yet *provisioned* — no
 * `DATABASE_URL`, or a database with no demo tenant in it.
 *
 * A distinct type rather than matching on an error message. The pages branch on
 * this to render a setup guide instead of an error boundary, and a string
 * comparison would silently stop working the moment the wording changed.
 */
export class SetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupRequiredError';
  }
}
