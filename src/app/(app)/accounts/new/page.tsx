import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountForm } from '@/components/account-form';
import { ArrowLeftIcon } from '@/components/icons';
import { translations } from '@/server/i18n';
import { createAccountAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.statement.openAnAccount };
}

export default async function NewAccountPage() {
  const { t } = await translations();

  return (
    <>
      <div className="space-y-1">
        <Link
          href="/accounts"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-xs transition-colors duration-150"
        >
          <ArrowLeftIcon width={13} height={13} />
          {t.accounts.title}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{t.statement.openAnAccount}</h1>
        <p className="text-ink-muted text-sm">{t.statement.classHint}</p>
      </div>

      <AccountForm
        action={createAccountAction}
        labels={{
          details: t.forms.accountDetails,
          intro: t.misc.accountFormIntro,
          neverDeleted: t.misc.accountsNeverDeleted,
          name: t.forms.accountName,
          nameHint: t.forms.accountNameHint,
          namePlaceholder: t.forms.accountNamePlaceholder,
          currency: t.forms.currency,
          klass: t.forms.accountClass,
          allowOverdraft: t.forms.allowOverdraft,
          overdraftNote: t.misc.overdraftNote,
          failed: t.forms.accountFailed,
          submit: t.forms.openAccount,
          opening: t.forms.opening,
          asset: t.accounts.asset,
          liability: t.accounts.liability,
          equity: t.accounts.equity,
          revenue: t.accounts.revenue,
          expense: t.accounts.expense,
          assetBlurb: t.accounts.assetBlurb,
          liabilityBlurb: t.accounts.liabilityBlurb,
          equityBlurb: t.accounts.equityBlurb,
          revenueBlurb: t.accounts.revenueBlurb,
          expenseBlurb: t.accounts.expenseBlurb,
        }}
      />
    </>
  );
}
