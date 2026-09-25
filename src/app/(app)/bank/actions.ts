'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describeError, translations } from '@/server/i18n';

export type BankState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

/** A year of an ordinary business account is well under this. */
const MAX_STATEMENT_BYTES = 512 * 1024;

const id = z.string().trim().min(1).max(60);

function refresh(accountId: string) {
  revalidatePath('/bank');
  revalidatePath(`/bank/${accountId}`);
}

export async function importStatementAction(
  _previous: BankState,
  formData: FormData,
): Promise<BankState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { locale, t } = await translations();

  const accountId = id.safeParse(formData.get('accountId'));
  const file = formData.get('file');
  if (!accountId.success || !(file instanceof File) || file.size === 0) {
    return { status: 'error', message: t.bank.chooseFile };
  }
  if (file.size > MAX_STATEMENT_BYTES) return { status: 'error', message: t.bank.chooseFile };

  const result = await writer.services.bank.importFile({
    accountId: accountId.data,
    text: await file.text(),
    filename: file.name.slice(0, 200),
    userId: writer.viewer.userId,
  });
  refresh(accountId.data);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.bank.imported(result.value.added, result.value.skipped) };
}

export async function matchLineAction(
  _previous: BankState,
  formData: FormData,
): Promise<BankState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { locale, t } = await translations();

  const parsed = z.object({ accountId: id, lineId: id, postingId: id }).safeParse({
    accountId: formData.get('accountId'),
    lineId: formData.get('lineId'),
    postingId: formData.get('postingId'),
  });
  if (!parsed.success) return { status: 'error', message: t.bank.chooseEntry };

  const result = await writer.services.bank.match({
    lineId: parsed.data.lineId,
    postingId: parsed.data.postingId,
    userId: writer.viewer.userId,
  });
  refresh(parsed.data.accountId);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.bank.matched };
}

export async function matchAllAction(_previous: BankState, formData: FormData): Promise<BankState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { t } = await translations();

  const accountId = id.safeParse(formData.get('accountId'));
  if (!accountId.success) return { status: 'error', message: t.bank.chooseEntry };
  const count = await writer.services.bank.matchSuggested(accountId.data, writer.viewer.userId);
  refresh(accountId.data);
  return { status: 'done', message: t.bank.matchedCount(count) };
}

export async function bookLineAction(_previous: BankState, formData: FormData): Promise<BankState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { locale, t } = await translations();

  const parsed = z.object({ accountId: id, lineId: id, counterAccountId: id }).safeParse({
    accountId: formData.get('accountId'),
    lineId: formData.get('lineId'),
    counterAccountId: formData.get('counterAccountId'),
  });
  if (!parsed.success) return { status: 'error', message: t.bank.chooseAccount };

  const result = await writer.services.bank.record({
    lineId: parsed.data.lineId,
    counterAccountId: parsed.data.counterAccountId,
    userId: writer.viewer.userId,
    via: 'ui',
  });
  refresh(parsed.data.accountId);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.bank.booked };
}

export async function unmatchLineAction(
  _previous: BankState,
  formData: FormData,
): Promise<BankState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { locale, t } = await translations();

  const parsed = z
    .object({ accountId: id, lineId: id })
    .safeParse({ accountId: formData.get('accountId'), lineId: formData.get('lineId') });
  if (!parsed.success) return { status: 'error', message: t.bank.chooseEntry };

  const result = await writer.services.bank.unmatch({
    lineId: parsed.data.lineId,
    userId: writer.viewer.userId,
  });
  refresh(parsed.data.accountId);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.bank.undone };
}
