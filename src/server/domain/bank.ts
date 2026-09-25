import { createHash } from 'node:crypto';
import { normaliseDate } from '@/lib/calendar';
import { parseTable } from '@/lib/csv';
import type { CurrencyCode } from '@/lib/money';
import { parseStatementAmount } from '@/lib/statement-amount';

/**
 * Bank statements, read and compared with the books by arithmetic alone.
 *
 * Pure, like the costing module: the service loads what the bank and the
 * books say, and this decides which lines a file contains, what makes a line
 * the same line twice, and which posting each line most probably is.
 */

/** What a column may be called, after `normaliseHeader`. Banks, and the people who re-save their exports, name them freely. */
const COLUMNS = {
  date: [
    'date',
    'transactiondate',
    'bookingdate',
    'postingdate',
    'valuedate',
    'ngay',
    'ngaygiaodich',
    'ngayhachtoan',
    'ngaygd',
    '日付',
    '取引日',
    'お取引日',
    '年月日',
  ],
  description: [
    'description',
    'details',
    'narrative',
    'memo',
    'particulars',
    'transactiondetails',
    'diengiai',
    'noidung',
    'noidunggiaodich',
    'mota',
    '摘要',
    '内容',
    'お取引内容',
  ],
  reference: [
    'reference',
    'ref',
    'referencenumber',
    'transactionid',
    'sothamchieu',
    'magiaodich',
    'soct',
    'sobuttoan',
    '参照番号',
    '取引番号',
  ],
  amount: ['amount', 'value', 'sotien', 'sotiengiaodich', '金額', '取引金額'],
  moneyIn: [
    'credit',
    'credits',
    'deposit',
    'deposits',
    'moneyin',
    'paidin',
    'ghico',
    'sotienghico',
    'phatsinhco',
    '入金',
    'お預入れ',
    '預入',
    '入金額',
    'お預入金額',
  ],
  moneyOut: [
    'debit',
    'debits',
    'withdrawal',
    'withdrawals',
    'moneyout',
    'paidout',
    'ghino',
    'sotienghino',
    'phatsinhno',
    '出金',
    'お引出し',
    '引出',
    '出金額',
    'お引出金額',
    '支払金額',
  ],
  balance: ['balance', 'runningbalance', 'sodu', 'soducuoi', '残高', '差引残高'],
} as const;

type Column = keyof typeof COLUMNS;

export type StatementRow = {
  /** 1-based, counting the header, so it matches the row number a spreadsheet shows. */
  readonly row: number;
  readonly occurredOn: string;
  readonly amount: bigint;
  readonly description: string;
  readonly reference: string | null;
  readonly balance: bigint | null;
  readonly fingerprint: string;
};

export type StatementProblem =
  | { readonly row: number; readonly problem: 'date'; readonly value: string }
  | { readonly row: number; readonly problem: 'amount'; readonly value: string }
  | { readonly row: number; readonly problem: 'both_sides' }
  | { readonly row: number; readonly problem: 'description' };

export type ReadStatement =
  | {
      readonly ok: true;
      readonly rows: readonly StatementRow[];
      readonly problems: readonly StatementProblem[];
    }
  | { readonly ok: false; readonly missing: readonly ('date' | 'amount' | 'description')[] };

/**
 * The lines of a statement export: CSV or tab-separated, pasted or uploaded.
 *
 * An amount comes from a signed column, or from separate money-in and
 * money-out columns — the two shapes banks actually export. A row with
 * nothing in any amount column is a heading or a subtotal and is skipped; a
 * row that cannot be read is reported by its number, not dropped, because a
 * reconciliation built on a file that silently lost a line is wrong in a way
 * nobody can find.
 */
export function readStatement(text: string, currency: CurrencyCode): ReadStatement {
  const { headers, rows } = parseTable(text);
  const index = mapColumns(headers);

  const missing: ('date' | 'amount' | 'description')[] = [];
  if (index.date === undefined) missing.push('date');
  if (index.amount === undefined && index.moneyIn === undefined && index.moneyOut === undefined) {
    missing.push('amount');
  }
  if (index.description === undefined && index.reference === undefined) {
    missing.push('description');
  }
  if (missing.length > 0) return { ok: false, missing };

  const cell = (values: readonly string[], column: Column) => {
    const at = index[column];
    return at === undefined ? '' : (values[at] ?? '').trim();
  };

  const read: Omit<StatementRow, 'fingerprint'>[] = [];
  const problems: StatementProblem[] = [];
  rows.forEach((values, position) => {
    const row = position + 2;
    if (values.every((value) => value.trim() === '')) return;

    const signed = cell(values, 'amount');
    const moneyIn = cell(values, 'moneyIn');
    const moneyOut = cell(values, 'moneyOut');
    if (!signed && !moneyIn && !moneyOut) return;

    const dateText = cell(values, 'date');
    const occurredOn = normaliseDate(dateText);
    if (!occurredOn) {
      problems.push({ row, problem: 'date', value: dateText });
      return;
    }

    let amount: bigint | null;
    if (signed) {
      amount = parseStatementAmount(signed, currency);
      if (amount === null) {
        problems.push({ row, problem: 'amount', value: signed });
        return;
      }
    } else {
      const inAmount = moneyIn ? parseStatementAmount(moneyIn, currency) : 0n;
      const outAmount = moneyOut ? parseStatementAmount(moneyOut, currency) : 0n;
      if (inAmount === null) {
        problems.push({ row, problem: 'amount', value: moneyIn });
        return;
      }
      if (outAmount === null) {
        problems.push({ row, problem: 'amount', value: moneyOut });
        return;
      }
      if (inAmount !== 0n && outAmount !== 0n) {
        problems.push({ row, problem: 'both_sides' });
        return;
      }
      // Some banks print withdrawals as negatives in their own column.
      amount = inAmount !== 0n ? abs(inAmount) : -abs(outAmount);
    }
    if (amount === 0n) return;

    const reference = cell(values, 'reference') || null;
    const description = (cell(values, 'description') || reference || '').slice(0, 500);
    if (!description) {
      problems.push({ row, problem: 'description' });
      return;
    }

    const balanceText = cell(values, 'balance');
    const balance = balanceText ? parseStatementAmount(balanceText, currency) : null;

    read.push({ row, occurredOn, amount, description, reference, balance });
  });

  return { ok: true, rows: withFingerprints(read), problems };
}

/**
 * What makes a line from a file the same line when the file is imported again.
 *
 * A bank export has no stable id, so the line's own content stands in for
 * one: day, amount, description, reference. Two identical coffees on the
 * same day are told apart by their order among identical lines, so the
 * second is kept and a re-import of the same statement still adds neither.
 */
export function withFingerprints(
  rows: readonly Omit<StatementRow, 'fingerprint'>[],
): StatementRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const content = [row.occurredOn, String(row.amount), row.description, row.reference ?? ''].join(
      '\u001f',
    );
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    const fingerprint = `file:${createHash('sha256').update(`${content}\u001f${occurrence}`).digest('hex')}`;
    return { ...row, fingerprint };
  });
}

/** A line from a feed is identified by the bank's own id for it. */
export function feedFingerprint(externalId: string): string {
  return `feed:${externalId}`;
}

export type Unmatched = {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly on: string;
  readonly amount: bigint;
};

export type Suggestion = {
  readonly lineId: string;
  /** Postings with the same amount within the window, nearest date first. */
  readonly candidates: readonly string[];
  /** The one to propose, when there is no doubt which it is. */
  readonly suggested: string | null;
};

/** Two weeks: a cheque takes a while to clear, and a transfer is booked the day it was sent. */
export const MATCH_WINDOW_DAYS = 14;

/**
 * Which posting each unmatched statement line most probably is.
 *
 * Only the same amount, to the unit, within two weeks. A posting is proposed
 * for a line only when each is the other's nearest — two rent payments of the
 * same figure a month apart are each proposed for their own month, while two
 * identical transfers on the same day are left for a person to pair, because
 * guessing between them is how a reconciliation comes out right for the
 * wrong reason.
 */
export function suggestMatches(
  lines: readonly Unmatched[],
  postings: readonly Unmatched[],
): Suggestion[] {
  const distance = (a: string, b: string) =>
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

  const nearest = (from: Unmatched, among: readonly Unmatched[]) => {
    const close = among
      .filter((other) => other.amount === from.amount)
      .map((other) => ({ other, days: distance(from.on, other.on) }))
      .filter(({ days }) => days <= MATCH_WINDOW_DAYS)
      .sort((a, b) => a.days - b.days || a.other.id.localeCompare(b.other.id));
    const first = close[0];
    const unique = first !== undefined && close[1]?.days !== first.days;
    return { close, best: unique ? first.other.id : null };
  };

  return lines.map((line) => {
    const { close, best } = nearest(line, postings);
    const posting = postings.find((candidate) => candidate.id === best);
    const mutual = posting ? nearest(posting, lines).best === line.id : false;
    return {
      lineId: line.id,
      candidates: close.map(({ other }) => other.id),
      suggested: mutual ? best : null,
    };
  });
}

function mapColumns(headers: readonly string[]): Partial<Record<Column, number>> {
  const index: Partial<Record<Column, number>> = {};
  for (const [column, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    const position = headers.findIndex((header) => names.includes(header));
    if (position >= 0) index[column] = position;
  }
  return index;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
