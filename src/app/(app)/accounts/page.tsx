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
import { demoServices } from '@/server/container';
import { buildPosition } from '@/server/queries';
import { normalBalanceOf } from '@/server/domain/account';
import type { AccountDto } from '@/server/services/dto';

export const metadata: Metadata = { title: 'Chart of accounts' };
export const dynamic = 'force-dynamic';

const CLASS_BLURB: Record<string, string> = {
  asset: 'What the business owns. Debits increase these.',
  liability: 'What the business owes. Credits increase these.',
  equity: "The owners' residual claim. Credits increase these.",
  revenue: 'Income earned. Credits increase these.',
  expense: 'Costs incurred. Debits increase these.',
};

export default async function AccountsPage() {
  let accounts: AccountDto[];
  try {
    accounts = await (await demoServices()).accounts.list();
  } catch (error) {
    if (error instanceof SetupRequiredError) {
      return <SetupNotice detail={error.message} />;
    }
    throw error;
  }

  const position = buildPosition(accounts, 'USD');

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="Grouped by class. Balances are shown the way an accountant reads them — positive means healthy, whichever side the account normally sits on."
        actions={
          <ButtonLink href="/transfer" variant="primary">
            Post an entry
            <ArrowRightIcon />
          </ButtonLink>
        }
      />

      {accounts.length === 0 ? (
        <Card>
          <EmptyState
            title="No accounts yet"
            description="Accounts are created through the API. Run pnpm db:seed to load a month of example books."
          />
        </Card>
      ) : (
        position.rows.map((group) => {
          const members = accounts.filter((account) => account.type === group.type);
          if (members.length === 0) return null;

          return (
            <Card key={group.type}>
              <CardHeader>
                <div className="space-y-0.5">
                  <CardTitle>{group.label}</CardTitle>
                  <CardDescription>{CLASS_BLURB[group.type] ?? ''}</CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-ink-muted text-[11px] tracking-wide uppercase">
                    {normalBalanceOf(group.type)}-normal
                  </p>
                  <p className="numeric text-sm font-semibold">
                    <Money value={group.total} showCurrency />
                  </p>
                </div>
              </CardHeader>

              <TableScroll>
                <Table caption={`${group.label} accounts and balances`}>
                  <thead>
                    <tr>
                      <Th>Account</Th>
                      <Th className="hidden lg:table-cell">Identifier</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        Overdraft
                      </Th>
                      <Th align="right">Balance</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        <span className="sr-only">Statement</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((account) => (
                      <Tr key={account.id}>
                        <Td>
                          <Link
                            href={`/accounts/${account.id}`}
                            className="font-medium hover:underline"
                          >
                            {account.name}
                          </Link>
                          {account.status === 'closed' ? (
                            <Badge tone="caution" className="ml-2">
                              Closed
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="text-ink-muted hidden font-mono text-xs lg:table-cell">
                          {account.id}
                        </Td>
                        <Td align="right" className="text-ink-muted hidden text-xs sm:table-cell">
                          {account.overdraftAllowed ? 'Allowed' : 'Blocked'}
                        </Td>
                        <Td align="right" numeric className="font-medium">
                          <Money value={account.balance} signed />
                        </Td>
                        <Td align="right" className="hidden sm:table-cell">
                          <Link
                            href={`/accounts/${account.id}`}
                            className="text-ink-muted hover:text-ink text-xs transition-colors duration-150"
                          >
                            Statement
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
          <p>
            Accounts with overdraft blocked cannot be pushed below zero. That rule is enforced by a
            CHECK constraint in Postgres as well as by the service, so it holds even for a writer
            that bypasses this application.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
