import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountForm } from '@/components/account-form';
import { ArrowLeftIcon } from '@/components/icons';
import { createAccountAction } from './actions';

export const metadata: Metadata = { title: 'Open an account' };

export default function NewAccountPage() {
  return (
    <>
      <div className="space-y-1">
        <Link
          href="/accounts"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-xs transition-colors duration-150"
        >
          <ArrowLeftIcon width={13} height={13} />
          Chart of accounts
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Open an account</h1>
        <p className="text-ink-muted text-sm">
          The class you choose is not cosmetic: it decides which side increases the balance, and how
          the account is presented everywhere it appears.
        </p>
      </div>

      <AccountForm action={createAccountAction} />
    </>
  );
}
