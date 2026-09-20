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
import { ArrowRightIcon } from '@/components/icons';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { buildPosition } from '@/server/queries';
import { normalBalanceOf } from '@/server/domain/account';
import type { AccountDto } from '@/server/services/dto';
import { classBlurb, classLabel } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.accounts.title };
}
export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
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

  const position = buildPosition(accounts);

  return (
    <>
      <PageHeader
        title={t.accounts.title}
        description={t.accounts.description}
        actions={
          <ButtonLink href="/transfer" variant="primary">
            {t.accounts.postEntry}
            <ArrowRightIcon />
          </ButtonLink>
        }
      />

      {accounts.length === 0 ? (
        <Card>
          <EmptyState title={t.accounts.emptyTitle} description={t.accounts.emptyBody} />
        </Card>
      ) : (
        position.rows.map((group) => {
          const members = accounts.filter((account) => account.type === group.type);
          if (members.length === 0) return null;
          const className = classLabel(group.type, t);

          return (
            <Card key={group.type}>
              <CardHeader>
                <div className="space-y-0.5">
                  <CardTitle>{className}</CardTitle>
                  <CardDescription>{classBlurb(group.type, t)}</CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-ink-muted text-[11px] tracking-wide uppercase">
                    {normalBalanceOf(group.type) === 'debit'
                      ? t.accounts.normalDebit
                      : t.accounts.normalCredit}
                  </p>
                  <p className="numeric text-sm font-semibold">
                    <Money value={group.total} showCurrency />
                  </p>
                </div>
              </CardHeader>

              <TableScroll>
                <Table caption={t.accounts.tableCaption(className)}>
                  <thead>
                    <tr>
                      {/*
                        The code leads, because this is how an accountant
                        reads a chart: down the numbers. It is narrow, fixed
                        and monospaced so the column scans as a column rather
                        than as ragged text.
                      */}
                      <Th className="w-20">{t.accounts.code}</Th>
                      <Th>{t.accounts.account}</Th>
                      <Th className="hidden xl:table-cell">{t.accounts.identifier}</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        {t.accounts.overdraft}
                      </Th>
                      <Th align="right">{t.accounts.balance}</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        <span className="sr-only">{t.accounts.statement}</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((account) => (
                      <Tr key={account.id}>
                        <Td className="text-ink-secondary font-mono text-xs tabular-nums">
                          {account.code ?? <span className="text-ink-muted">—</span>}
                        </Td>
                        <Td>
                          <Link
                            href={`/accounts/${account.id}`}
                            className="font-medium hover:underline"
                          >
                            {account.name}
                          </Link>
                          {account.status === 'closed' ? (
                            <Badge tone="caution" className="ml-2">
                              {t.accounts.closed}
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="text-ink-muted hidden font-mono text-xs xl:table-cell">
                          {account.id}
                        </Td>
                        <Td align="right" className="text-ink-muted hidden text-xs sm:table-cell">
                          {account.overdraftAllowed
                            ? t.accounts.overdraftAllowed
                            : t.accounts.overdraftBlocked}
                        </Td>
                        <Td align="right" numeric className="font-medium">
                          {/*
                            The currency is shown on every row, not only the
                            foreign ones. On a chart holding dong, dollars,
                            euros and Australian dollars, a bare number is a
                            number the reader has to guess the unit of — and
                            guessing wrong by a factor of twenty-five thousand
                            is the kind of mistake this whole project exists
                            to prevent.
                          */}
                          <Money value={account.balance} signed showCurrency />
                        </Td>
                        <Td align="right" className="hidden sm:table-cell">
                          <Link
                            href={`/accounts/${account.id}`}
                            className="text-ink-muted hover:text-ink text-xs transition-colors duration-150"
                          >
                            {t.accounts.statement}
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </Card>
          );
        })
      )}

      <Card>
        <CardBody className="text-ink-muted text-xs">
          <p>{t.accounts.overdraftNote}</p>
        </CardBody>
      </Card>
    </>
  );
}
