import type { Metadata } from 'next';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { EntryComposer } from '@/components/entry-composer';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { postEntryAction } from './actions';
import type { AccountDto } from '@/server/services/dto';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.transfer.title };
}
export const dynamic = 'force-dynamic';

export default async function PostEntryPage() {
  const { t } = await translations();
  let accounts: AccountDto[];
  try {
    accounts = await (await viewerServices()).services.accounts.list();
  } catch (error) {
    if (error instanceof SetupRequiredError) {
      return <SetupNotice detail={error.message} />;
    }
    throw error;
  }

  return (
    <>
      <PageHeader title={t.transfer.title} description={t.transfer.description} />

      {accounts.length === 0 ? (
        <Card>
          <CardBody className="text-ink-muted text-sm">
            There are no accounts to post to yet. Run{' '}
            <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono text-xs">
              pnpm db:seed
            </code>{' '}
            to load a month of example books.
          </CardBody>
        </Card>
      ) : (
        // Denominated in the currency the books are kept in. Hard-coding USD
        // meant a dong ledger offered a form nobody could post an entry with.
        <EntryComposer
          accounts={accounts}
          currency={accounts[0]?.baseBalance.currency ?? 'USD'}
          action={postEntryAction}
        />
      )}
    </>
  );
}
