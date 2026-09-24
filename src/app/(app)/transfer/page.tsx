import type { Metadata } from 'next';
import Link from 'next/link';
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
          <CardBody className="space-y-3 text-sm">
            <p className="text-ink-muted">{t.misc.noAccountsToPost}</p>
            <Link
              href="/accounts/new"
              className="text-ink font-medium underline underline-offset-2"
            >
              {t.misc.openChart}
            </Link>
          </CardBody>
        </Card>
      ) : (
        // Denominated in the currency the books are kept in. Hard-coding USD
        // meant a dong ledger offered a form nobody could post an entry with.
        <EntryComposer
          labels={{
            entryDetails: t.forms.entryDetails,
            entryDetailsHint: t.forms.entryDetailsHint,
            description: t.forms.description,
            descriptionHint: t.forms.descriptionHint,
            descriptionPlaceholder: t.forms.descriptionPlaceholder,
            currency: t.forms.currency,
            postings: t.forms.postings,
            postingsHint: t.forms.postingsHint,
            lineAccount: t.forms.lineAccount,
            sumToZero: t.forms.sumToZero,
            selectAccount: t.forms.selectAccount,
            side: t.forms.side,
            debit: t.journal.debit,
            credit: t.journal.credit,
            amount: t.forms.amount,
            addPosting: t.forms.addPosting,
            remove: t.forms.remove,
            incomplete: t.forms.incomplete,
            balanced: t.journal.balanced,
            failed: t.forms.entryFailed,
            submit: t.forms.postEntry,
            posting: t.forms.posting,
            viewJournal: t.misc.viewJournal,
          }}
          accounts={accounts}
          currency={accounts[0]?.baseBalance.currency ?? 'USD'}
          action={postEntryAction}
        />
      )}
    </>
  );
}
