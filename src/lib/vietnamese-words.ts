import { exponentOf, type CurrencyCode } from './money';

/**
 * An amount in Vietnamese words, as a VAT invoice must carry it.
 *
 * "Một triệu hai trăm năm mươi nghìn đồng" — the total written out is a
 * required field of the e-invoice (Tổng tiền thanh toán bằng chữ), and the
 * reading rules are particular enough that a generic number speller gets
 * them wrong:
 *
 * - a zero in the tens before a unit is "lẻ": 105 is "một trăm lẻ năm";
 * - 1 after a tens digit above one is "mốt", and 5 after any tens is
 *   "lăm": 21 is "hai mươi mốt", 15 "mười lăm", 25 "hai mươi lăm";
 * - 4 after a tens digit above one is "tư": 24 is "hai mươi tư";
 * - a group after the first is read in full even when it starts with
 *   zeros — 1,000,005 is "một triệu không trăm lẻ năm" — while a group
 *   that is all zeros is left out, scale word and all;
 * - the scales are nghìn, triệu, tỷ, and then nghìn tỷ, triệu tỷ.
 */
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const SCALES = ['', 'nghìn', 'triệu', 'tỷ'];

const CURRENCY_WORDS: Partial<Record<CurrencyCode, { unit: string; minor?: string }>> = {
  VND: { unit: 'đồng' },
  USD: { unit: 'đô la Mỹ', minor: 'xu' },
  EUR: { unit: 'euro', minor: 'xu' },
  JPY: { unit: 'yên Nhật' },
  AUD: { unit: 'đô la Úc', minor: 'xu' },
};

export function amountInVietnameseWords(amount: bigint, currency: CurrencyCode): string {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const exponent = exponentOf(currency);
  const scale = 10n ** BigInt(exponent);
  const whole = magnitude / scale;
  const fraction = magnitude % scale;
  const words = CURRENCY_WORDS[currency] ?? { unit: currency };

  let text = `${numberInWords(whole)} ${words.unit}`;
  if (fraction > 0n) text += ` và ${numberInWords(fraction)} ${words.minor ?? ''}`.trimEnd();
  if (negative) text = `âm ${text}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A non-negative integer in Vietnamese words, without a unit. */
export function numberInWords(value: bigint): string {
  if (value === 0n) return DIGITS[0] ?? 'không';

  // Groups of three, least significant first.
  const groups: number[] = [];
  for (let rest = value; rest > 0n; rest /= 1000n) groups.push(Number(rest % 1000n));

  const parts: string[] = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index] ?? 0;
    if (group === 0) continue;
    const leading = index === groups.length - 1;
    parts.push(threeDigits(group, !leading));
    const name = scaleName(index);
    if (name) parts.push(name);
  }
  return parts.join(' ');
}

/** nghìn, triệu, tỷ, nghìn tỷ, triệu tỷ, tỷ tỷ… */
function scaleName(index: number): string {
  if (index === 0) return '';
  const tier = Math.floor((index - 1) / 3);
  const within = SCALES[((index - 1) % 3) + 1] ?? '';
  return [within, ...Array.from({ length: tier }, () => 'tỷ')].join(' ').trim();
}

function threeDigits(group: number, full: boolean): string {
  const hundreds = Math.floor(group / 100);
  const tens = Math.floor((group % 100) / 10);
  const units = group % 10;
  const words: string[] = [];

  if (full || hundreds > 0) words.push(`${DIGITS[hundreds]} trăm`);

  if (tens === 0) {
    if (units > 0 && words.length > 0) words.push('lẻ');
  } else if (tens === 1) {
    words.push('mười');
  } else {
    words.push(`${DIGITS[tens]} mươi`);
  }

  if (units > 0) {
    if (units === 1 && tens > 1) words.push('mốt');
    else if (units === 5 && tens > 0) words.push('lăm');
    else if (units === 4 && tens > 1) words.push('tư');
    else words.push(DIGITS[units] ?? '');
  }
  return words.join(' ');
}
