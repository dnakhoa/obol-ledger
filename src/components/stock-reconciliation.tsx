import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableScroll, Td, Th, Tr } from './ui/table';
import { AlertIcon, CheckIcon } from './icons';
import { Money } from './money';
import { cn } from '@/lib/cn';
import { dateFormats } from '@/lib/i18n';
import { translations } from '@/server/i18n';
import type { StockReconciliation } from '@/server/services/inventory';

/**
 * The lots against the inventory accounts, and who to blame when they differ.
 *
 * Shown on the stock page and at month end, because those are the two places
 * somebody is about to rely on the figure: one to quote a price from what the
 * stock cost, the other to sign off a balance sheet with it on.
 *
 * When they agree it is a single line. When they do not, the entries that did
 * it are listed with links, because "the accounts are out by 45,000" is a
 * finding and "this accrual typed onto 156 on the 31st" is a fix.
 */
export async function StockReconciliationCard({
  reconciliation,
}: {
  reconciliation: StockReconciliation;
}) {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);
  const agrees = reconciliation.agrees;

  return (
    <Card className={cn(!agrees && 'border-negative')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {agrees ? (
            <CheckIcon className="text-positive shrink-0" />
          ) : (
            <AlertIcon className="text-negative shrink-0" />
          )}
          {agrees ? t.reconcile.agrees : t.reconcile.disagrees}
        </CardTitle>
        <CardDescription>
          {agrees ? t.reconcile.agreesBody : t.reconcile.disagreesBody}
        </CardDescription>
      </CardHeader>
      <TableScroll>
        <Table caption={t.reconcile.caption}>
          <thead>
            <tr>
              <Th>{t.reconcile.account}</Th>
              <Th hideBelow="sm" align="right">
                {t.reconcile.products}
              </Th>
              <Th hideBelow="md" align="right">
                {t.reconcile.ledger}
              </Th>
              <Th hideBelow="md" align="right">
                {t.reconcile.lots}
              </Th>
              <Th align="right">{t.reconcile.difference}</Th>
            </tr>
          </thead>
          {reconciliation.accounts.map((account) => (
            <tbody key={account.accountId}>
              <Tr>
                <Td>
                  <Link
                    href={`/accounts/${account.accountId}`}
                    className="hover:text-action font-medium underline-offset-4 hover:underline"
                  >
                    {account.accountCode
                      ? `${account.accountCode} — ${account.accountName}`
                      : account.accountName}
                  </Link>
                </Td>
                <Td hideBelow="sm" align="right" numeric>
                  {account.items}
                </Td>
                <Td hideBelow="md" align="right" numeric>
                  <Money value={account.ledger} />
                </Td>
                <Td hideBelow="md" align="right" numeric>
                  <Money value={account.lots} />
                </Td>
                <Td align="right" numeric>
                  <Money
                    value={account.difference}
                    className={cn(
                      account.difference.minorUnits !== '0' && 'text-negative font-semibold',
                    )}
                  />
                </Td>
              </Tr>
              {account.difference.minorUnits === '0'
                ? null
                : account.unexplained.map((entry) => (
                    <Tr key={entry.transactionId}>
                      <Td className="pl-8 text-xs">
                        <span className="text-ink-muted mr-2">{t.reconcile.unexplained}</span>
                        <Link
                          href={`/journal/${entry.transactionId}`}
                          className="hover:text-action underline-offset-4 hover:underline"
                        >
                          {DATE.day(entry.occurredAt)} · {entry.description}
                        </Link>
                      </Td>
                      <Td hideBelow="sm" />
                      <Td hideBelow="md" />
                      <Td hideBelow="md" />
                      <Td align="right" numeric className="text-xs">
                        <Money value={entry.amount} />
                      </Td>
                    </Tr>
                  ))}
            </tbody>
          ))}
        </Table>
      </TableScroll>
    </Card>
  );
}
