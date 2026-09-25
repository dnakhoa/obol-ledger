import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { StatTile } from '@/components/stat-tile';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { ArrowLeftIcon } from '@/components/icons';
import {
  ImportStatementForm,
  LineResolver,
  MatchAllButton,
  UndoMatch,
  type Option,
} from '@/components/bank-forms';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';

type PageProps = { params: Promise<{ accountId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { t } = await translations();
  const { accountId } = await params;
  try {
    const account = (await (await viewerServices()).services.bank.accounts()).find(
      (candidate) => candidate.id === accountId,
    );
    if (account) return { title: `${account.name} · ${t.bank.title}` };
  } catch {
    // The page renders its own notice; a title is not worth failing on.
  }
  return { title: t.bank.title };
}
export const dynamic = 'force-dynamic';

/**
 * One account, reconciled against its statement.
 *
 * Top to bottom in the order the work is done: the two balances and whether
 * they agree; the statement lines the books do not have yet, each with the
 * entry it most probably is or a way to book it; the entries the bank has
 * not seen yet; and what is already matched, with a way to undo it.
 */
export default async function BankAccountPage({ params }: PageProps) {
  const { accountId } = await params;
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);
  const day = (value: string) => DATE.day(new Date(`${value}T12:00:00Z`));

  let account, lines, report, allAccounts, canWrite, functional;
  try {
    const { services, viewer } = await viewerServices();
    account = (await services.bank.accounts()).find((candidate) => candidate.id === accountId);
    if (!account) notFound();
    const reconciliation = await services.bank.reconciliation(accountId);
    if (!reconciliation.ok) notFound();
    report = reconciliation.value;
    [lines, allAccounts] = await Promise.all([
      services.bank.lines(accountId),
      services.accounts.list(),
    ]);
    canWrite = viewer.kind !== 'unenrolled' && viewer.canWrite;
    functional = report.functionalCurrency;
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const bankCurrency = account.currency;
  // What a line can be booked against: any open account but this one, in
  // the account's currency or the books' own — anything else needs a cross
  // rate nobody supplied.
  const bookable: Option[] = allAccounts
    .filter(
      (candidate) =>
        candidate.status === 'open' &&
        candidate.id !== account.id &&
        candidate.role === null &&
        (candidate.balance.currency === bankCurrency || candidate.balance.currency === functional),
    )
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.code ? `${candidate.code} — ${candidate.name}` : candidate.name,
    }));

  const unmatched = lines.filter((line) => line.match === null);
  const matched = lines.filter((line) => line.match !== null).slice(0, 50);
  const suggestedCount = unmatched.filter((line) => line.suggested !== null).length;
  const reconciled = report.reconciled;

  const resolverLabels = {
    match: t.bank.match,
    chooseEntry: t.bank.chooseEntry,
    book: t.bank.book,
    chooseAccount: t.bank.chooseAccount,
    working: t.common.working,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.code ? `${account.code} — ${account.name}` : account.name}
        description={t.bank.reconcileHint}
        actions={
          <ButtonLink href="/bank">
            <ArrowLeftIcon />
            {t.bank.back}
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label={t.bank.inBooks}
          value={<Money value={report.ledger} />}
          unit={report.currency}
        />
        <StatTile
          label={t.bank.perBank}
          value={
            report.statement ? (
              <Money value={report.statement} />
            ) : (
              <span className="text-ink-muted text-sm">{t.bank.noStatementBalance}</span>
            )
          }
          {...(report.statementOn ? { unit: t.bank.asOf(day(report.statementOn)) } : {})}
        />
        <StatTile
          label={t.bank.notInBooks}
          value={<Money value={report.bankOnly.total} />}
          unit={t.bank.linesCount(report.bankOnly.count)}
        />
        <StatTile
          label={reconciled ? t.bank.reconciled : t.bank.difference}
          value={
            reconciled ? (
              <Badge tone="positive">{t.bank.reconciled}</Badge>
            ) : report.difference ? (
              <Money value={report.difference} />
            ) : (
              '—'
            )
          }
        />
      </div>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.bank.importTitle}</CardTitle>
            <CardDescription>{t.bank.importHint}</CardDescription>
          </CardHeader>
          <CardBody>
            <ImportStatementForm
              accountId={account.id}
              labels={{
                file: t.bank.file,
                submit: t.bank.importButton,
                working: t.common.working,
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-0.5">
              <CardTitle>{t.bank.toMatchTitle}</CardTitle>
              <CardDescription>{t.bank.toMatchHint}</CardDescription>
            </div>
            {canWrite && suggestedCount > 0 ? (
              <MatchAllButton
                accountId={account.id}
                label={t.bank.matchAll(suggestedCount)}
                working={t.common.working}
              />
            ) : null}
          </div>
        </CardHeader>
        {unmatched.length === 0 ? (
          <EmptyState title={t.bank.nothingToMatch} description={t.bank.toMatchHint} />
        ) : (
          <TableScroll>
            <Table caption={t.bank.toMatchTitle}>
              <thead>
                <tr>
                  <Th>{t.bank.date}</Th>
                  <Th>{t.bank.details}</Th>
                  <Th align="right">{t.bank.amount}</Th>
                  <Th>{t.bank.action}</Th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((line) => (
                  <Tr key={line.id}>
                    <Td numeric className="whitespace-nowrap">
                      {day(line.occurredOn)}
                    </Td>
                    <Td>
                      <span className="block max-w-80 truncate">{line.description}</span>
                      {line.reference ? (
                        <span className="text-ink-muted text-xs">{line.reference}</span>
                      ) : null}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={line.amount} />
                    </Td>
                    <Td>
                      {canWrite ? (
                        <LineResolver
                          accountId={account.id}
                          lineId={line.id}
                          suggested={line.suggested}
                          candidates={line.candidates.map((candidate) => ({
                            id: candidate.postingId,
                            label: `${candidate.postingId === line.suggested ? `${t.bank.looksLike}: ` : ''}${candidate.description} · ${day(candidate.occurredOn)}`,
                          }))}
                          accounts={bookable}
                          labels={resolverLabels}
                        />
                      ) : line.candidates[0] ? (
                        <span className="text-ink-secondary text-xs">
                          {t.bank.looksLike}: {line.candidates[0].description}
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.bank.booksOnlyTitle}</CardTitle>
          <CardDescription>{t.bank.booksOnlyHint}</CardDescription>
        </CardHeader>
        {report.booksOnly.lines.length === 0 ? (
          <CardBody>
            <p className="text-ink-muted text-sm">{t.bank.nothingBooksOnly}</p>
          </CardBody>
        ) : (
          <TableScroll>
            <Table caption={t.bank.booksOnlyTitle}>
              <thead>
                <tr>
                  <Th>{t.bank.date}</Th>
                  <Th>{t.bank.entry}</Th>
                  <Th align="right">{t.bank.amount}</Th>
                </tr>
              </thead>
              <tbody>
                {report.booksOnly.lines.map((posting) => (
                  <Tr key={posting.postingId}>
                    <Td numeric className="whitespace-nowrap">
                      {day(posting.occurredOn)}
                    </Td>
                    <Td>
                      <Link
                        href={`/journal/${posting.transactionId}`}
                        className="hover:text-action underline-offset-4 hover:underline"
                      >
                        {posting.description}
                      </Link>
                    </Td>
                    <Td align="right" numeric>
                      <Money value={posting.amount} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      {matched.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.bank.matchedTitle}</CardTitle>
          </CardHeader>
          <TableScroll>
            <Table caption={t.bank.matchedTitle}>
              <thead>
                <tr>
                  <Th>{t.bank.date}</Th>
                  <Th>{t.bank.details}</Th>
                  <Th hideBelow="md">{t.bank.entry}</Th>
                  <Th align="right">{t.bank.amount}</Th>
                  {canWrite ? (
                    <Th align="right">
                      <span className="sr-only">{t.bank.undo}</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {matched.map((line) => (
                  <Tr key={line.id}>
                    <Td numeric className="whitespace-nowrap">
                      {day(line.occurredOn)}
                    </Td>
                    <Td>
                      <span className="block max-w-72 truncate">{line.description}</span>
                    </Td>
                    <Td hideBelow="md">
                      {line.match ? (
                        <Link
                          href={`/journal/${line.match.transactionId}`}
                          className="hover:text-action text-ink-secondary text-xs underline-offset-4 hover:underline"
                        >
                          {line.match.description}
                        </Link>
                      ) : null}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={line.amount} />
                    </Td>
                    {canWrite ? (
                      <Td align="right">
                        <UndoMatch
                          accountId={account.id}
                          lineId={line.id}
                          label={t.bank.undo}
                          working={t.common.working}
                        />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      ) : null}
    </div>
  );
}
