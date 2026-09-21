import { translations } from '@/server/i18n';
import { Card, CardBody } from './ui/card';
import { AlertIcon } from './icons';

/**
 * Shown when `DATABASE_URL` is missing.
 *
 * A cloned repository with no database should explain itself rather than
 * present a stack trace. Distinguishing "not configured yet" from "the database
 * is down" is also the difference between a five-minute fix and a support
 * ticket.
 */
export async function SetupNotice({ detail }: { detail: string }) {
  // A Server Component, so it reads the locale itself rather than making
  // fourteen callers remember to pass it.
  const { t } = await translations();
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-caution mt-0.5">
            <AlertIcon />
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t.misc.noDatabase}</h2>
            <p className="text-ink-muted text-xs">{detail}</p>
          </div>
        </div>

        <ol className="text-ink-secondary space-y-2 text-xs">
          <li className="flex gap-2">
            <span className="text-ink-muted">1.</span>
            <span>
              Copy{' '}
              <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono">.env.example</code>{' '}
              to <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono">.env.local</code>{' '}
              and set{' '}
              <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono">DATABASE_URL</code>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-ink-muted">2.</span>
            <span>
              Apply the schema:{' '}
              <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono">
                pnpm db:migrate
              </code>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-ink-muted">3.</span>
            <span>
              Load a month of example books:{' '}
              <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono">pnpm db:seed</code>
            </span>
          </li>
        </ol>
      </CardBody>
    </Card>
  );
}
