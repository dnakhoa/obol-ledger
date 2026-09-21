import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { FileReturnButton, TaxCodeForm } from '@/components/tax-filing';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats, type Messages } from '@/lib/i18n';
import { formatRate } from '@/server/domain/tax';
import type { TaxReturnDto } from '@/server/services/tax-return';
import { createTaxCodeAction, fileReturnAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.tax.title };
}
export const dynamic = 'force-dynamic';

/**
 * Filing a consumption tax return.
 *
 * One period, no chooser, and the arithmetic shown in full above the button —
 * because the figure a return produces is one somebody signs their name to,
 * and a number with no visible derivation is a number nobody can defend. The
 * bands are the lines of the form; the three totals below them are the
 * subtraction the form performs.
 */
export default async function TaxPage() {
  const { locale, t } = await translations();
  const format = dateFormats(locale);

  let codes: Awaited<
    ReturnType<Awaited<ReturnType<typeof viewerServices>>['services']['tax']['list']>
  >;
  let accounts: Awaited<
    ReturnType<Awaited<ReturnType<typeof viewerServices>>['services']['accounts']['list']>
  >;
  let filed: readonly TaxReturnDto[];
  let pending: TaxReturnDto | null = null;
  let period: { periodStart: string; periodEnd: string } | null = null;

  try {
    const { services } = await viewerServices();
    [codes, accounts, filed, period] = await Promise.all([
      services.tax.list(),
      services.accounts.list(),
      services.taxReturns.list(),
      services.taxReturns.nextPeriod(),
    ]);
    if (period) {
      const preview = await services.taxReturns.preview(period);
      if (preview.ok) pending = preview.value;
    }
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.tax.title} description={t.tax.description} />

      {codes.length === 0 ? (
        <Card>
          <EmptyState title={t.tax.noCodes} description={t.tax.noCodesBody} />
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.tax.period}</CardTitle>
            <CardDescription>
              {period && pending
                ? t.tax.periodReady(format.month(new Date(`${period.periodStart}T00:00:00Z`)))
                : t.tax.nothingDueBody}
            </CardDescription>
          </div>
        </CardHeader>

        {period && pending ? (
          <>
            <Bands title={t.tax.sales} bands={pending.sales} t={t} />
            <Bands title={t.tax.purchases} bands={pending.purchases} t={t} />

            <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure label={t.tax.outputTax} value={pending.outputTax} />
              <Figure label={t.tax.inputTax} value={pending.inputTax} />
              <Figure label={t.tax.broughtForward} value={pending.broughtForward} />
              {pending.payable.minorUnits === '0' ? (
                <Figure label={t.tax.carriedForward} value={pending.carriedForward} emphasis />
              ) : (
                <Figure label={t.tax.payable} value={pending.payable} emphasis />
              )}
            </CardBody>

            {pending.payable.minorUnits === '0' && pending.carriedForward.minorUnits !== '0' ? (
              <CardBody className="text-ink-muted pt-0 text-xs">
                <p>{t.tax.carriedExplainer}</p>
              </CardBody>
            ) : null}

            <CardBody className="pt-0">
              <FileReturnButton
                action={fileReturnAction}
                periodStart={period.periodStart}
                periodEnd={period.periodEnd}
                label={t.tax.fileReturn}
                pendingLabel={t.tax.filing}
              />
            </CardBody>
          </>
        ) : (
          <CardBody className="text-ink-muted text-sm">
            <p>{t.tax.nothingDue}</p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.tax.filed}</CardTitle>
            <CardDescription>{t.tax.inOrder}</CardDescription>
          </div>
        </CardHeader>

        {filed.length === 0 ? (
          <EmptyState title={t.tax.noReturns} description={t.tax.noReturnsBody} />
        ) : (
          <TableScroll>
            <Table caption={t.tax.filedCaption}>
              <thead>
                <tr>
                  <Th>{t.tax.periodColumn}</Th>
                  <Th align="right">{t.tax.outputTax}</Th>
                  <Th align="right">{t.tax.inputTax}</Th>
                  <Th align="right">{t.tax.payable}</Th>
                  <Th align="right">{t.tax.carriedForward}</Th>
                  <Th>{t.tax.filedOn}</Th>
                </tr>
              </thead>
              <tbody>
                {filed.map((item) => (
                  <Tr key={item.id ?? item.periodStart}>
                    <Td>
                      {format.month(new Date(`${item.periodStart}T00:00:00Z`))}
                      {item.periodStart.slice(0, 7) === item.periodEnd.slice(0, 7)
                        ? ''
                        : ` — ${format.month(new Date(`${item.periodEnd}T00:00:00Z`))}`}
                    </Td>
                    <Td align="right">
                      <Money value={item.outputTax} />
                    </Td>
                    <Td align="right">
                      <Money value={item.inputTax} />
                    </Td>
                    <Td align="right">
                      <Money value={item.payable} />
                    </Td>
                    <Td align="right">
                      <Money value={item.carriedForward} />
                    </Td>
                    <Td>
                      {item.transactionId ? (
                        <Link className="underline" href={`/journal/${item.transactionId}`}>
                          {t.tax.viewEntry}
                        </Link>
                      ) : (
                        <span className="text-ink-muted">{t.tax.noEntry}</span>
                      )}
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
          <div className="space-y-0.5">
            <CardTitle>{t.tax.codes}</CardTitle>
            <CardDescription>{t.tax.codesDescription}</CardDescription>
          </div>
        </CardHeader>

        {codes.length > 0 ? (
          <TableScroll>
            <Table caption={t.tax.codes}>
              <thead>
                <tr>
                  <Th>{t.tax.codeName}</Th>
                  <Th>{t.tax.rate}</Th>
                  <Th>{t.tax.treatment}</Th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <Tr key={code.id}>
                    <Td>{code.name}</Td>
                    <Td>{formatRate(code.rateBasisPoints)}</Td>
                    <Td>
                      <Badge tone="neutral">{treatmentLabel(code.treatment, t)}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        ) : null}

        <CardBody>
          <TaxCodeForm
            action={createTaxCodeAction}
            label={t.tax.addCode}
            pendingLabel={t.tax.filing}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field htmlFor="tax-name" label={t.tax.codeName}>
                <Input id="tax-name" name="name" required maxLength={80} />
              </Field>
              <Field htmlFor="tax-percent" label={t.tax.rate} hint="10, 8.25, 0">
                <Input id="tax-percent" name="percent" required inputMode="decimal" />
              </Field>
              <Field htmlFor="tax-treatment" label={t.tax.treatment}>
                <Select id="tax-treatment" name="treatment" defaultValue="vat">
                  <option value="vat">{t.tax.vat}</option>
                  <option value="reverse_charge">{t.tax.reverseCharge}</option>
                  <option value="sales_tax">{t.tax.salesTax}</option>
                </Select>
              </Field>
              <Field htmlFor="tax-output" label={t.tax.outputAccount}>
                <Select id="tax-output" name="outputAccountId" defaultValue="">
                  <option value="">{t.tax.none}</option>
                  {accounts
                    .filter((account) => account.type === 'liability')
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code ? `${account.code} — ` : ''}
                        {account.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field htmlFor="tax-input" label={t.tax.inputAccount}>
                <Select id="tax-input" name="inputAccountId" defaultValue="">
                  <option value="">{t.tax.none}</option>
                  {accounts
                    .filter((account) => account.type === 'asset')
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code ? `${account.code} — ` : ''}
                        {account.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>

            {/*
              The three kinds, explained where the choice is made. Which one a
              rate is decides how many legs an entry gets and which side they
              land on, and it is not recoverable from the percentage — a 10%
              VAT and a 10% reverse charge look identical in the list and
              behave nothing alike.
            */}
            <dl className="text-ink-muted space-y-2 text-xs">
              <div>
                <dt className="text-ink font-medium">{t.tax.vat}</dt>
                <dd>{t.tax.vatHint}</dd>
              </div>
              <div>
                <dt className="text-ink font-medium">{t.tax.reverseCharge}</dt>
                <dd>{t.tax.reverseChargeHint}</dd>
              </div>
              <div>
                <dt className="text-ink font-medium">{t.tax.salesTax}</dt>
                <dd>{t.tax.salesTaxHint}</dd>
              </div>
            </dl>
          </TaxCodeForm>
        </CardBody>
      </Card>
    </div>
  );
}

function treatmentLabel(treatment: string, t: Messages): string {
  if (treatment === 'reverse_charge') return t.tax.reverseCharge;
  if (treatment === 'sales_tax') return t.tax.salesTax;
  return t.tax.vat;
}

function Bands({ title, bands, t }: { title: string; bands: TaxReturnDto['sales']; t: Messages }) {
  if (bands.length === 0) return null;
  return (
    <TableScroll>
      <Table caption={title}>
        <thead>
          <tr>
            <Th>{title}</Th>
            <Th>{t.tax.rate}</Th>
            <Th align="right">{t.tax.base}</Th>
            <Th align="right">{t.tax.taxAmount}</Th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => (
            <Tr key={band.taxCodeId}>
              <Td>{band.name}</Td>
              <Td>{band.rate}</Td>
              <Td align="right">
                <Money value={band.base} />
              </Td>
              <Td align="right">
                <Money value={band.tax} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

function Figure({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: TaxReturnDto['payable'];
  emphasis?: boolean;
}) {
  return (
    <div className="border-line bg-surface-sunken rounded-lg border p-3">
      <p className="text-ink-muted text-[11px]">{label}</p>
      <p className={emphasis ? 'numeric text-base font-semibold' : 'numeric text-sm font-medium'}>
        <Money value={value} />
      </p>
    </div>
  );
}
