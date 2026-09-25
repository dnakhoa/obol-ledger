import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import type { BankAccountSummary } from '@/server/services/bank';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.bank.title };
}
export const dynamic = 'force-dynamic';

/**
 * Every account with a bank statement, and how much of it is still unmatched.
 *
 * The "still to match" column is the page: it is the month-end work left,
 * counted, for each account the business banks with.
 */
export default async function BankPage() {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);

  let accounts: readonly BankAccountSummary[];
  try {
    accounts = await (await viewerServices()).services.bank.accounts();
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  // Accounts with a statement first; the rest are offered, not listed as work.
  const withStatement = accounts.filter((account) => account.lines > 0);
  const others = accounts.filter((account) => account.lines === 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t.bank.title} description={t.bank.description} />

      <Card>
        {accounts.length === 0 ? (
          <EmptyState title={t.bank.noAccounts} description={t.bank.noAccountsBody} />
        ) : withStatement.length === 0 ? (
          <EmptyState title={t.bank.noStatements} description={t.bank.noStatementsBody} />
        ) : (
          <TableScroll>
            <Table caption={t.bank.accountsCaption}>
              <thead>
                <tr>
                  <Th>{t.bank.account}</Th>
                  <Th align="right">{t.bank.inBooks}</Th>
                  <Th hideBelow="sm" align="right">
                    {t.bank.lines}
                  </Th>
                  <Th align="right">{t.bank.toMatch}</Th>
                  <Th hideBelow="md">{t.bank.latestLine}</Th>
                  <Th align="right">
                    <span className="sr-only">{t.bank.reconcile}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {withStatement.map((account) => (
                  <Tr key={account.id}>
                    <Td>
                      <Link
                        href={`/bank/${account.id}`}
                        className="hover:text-action font-medium underline-offset-4 hover:underline"
                      >
                        {account.code ? `${account.code} — ${account.name}` : account.name}
                      </Link>
                    </Td>
                    <Td align="right" numeric>
                      <Money value={account.balance} />
                    </Td>
                    <Td hideBelow="sm" align="right" numeric>
                      {account.lines}
                    </Td>
                    <Td align="right" numeric>
                      <Badge tone={account.unmatched > 0 ? 'caution' : 'neutral'}>
                        {account.unmatched}
                      </Badge>
                    </Td>
                    <Td hideBelow="md" numeric>
                      {account.lastLineOn
                        ? DATE.day(new Date(`${account.lastLineOn}T12:00:00Z`))
                        : '—'}
                    </Td>
                    <Td align="right">
                      <ButtonLink href={`/bank/${account.id}`} size="sm">
                        {t.bank.reconcile}
                      </ButtonLink>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      {others.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.bank.others}</CardTitle>
            <CardDescription>{t.bank.othersHint}</CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {others.map((account) => (
                <li key={account.id}>
                  <ButtonLink href={`/bank/${account.id}`} size="sm">
                    {account.code ? `${account.code} — ${account.name}` : account.name}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
