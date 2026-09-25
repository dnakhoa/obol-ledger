import { describe, expect, it } from 'vitest';
import { amountInVietnameseWords, numberInWords } from '@/lib/vietnamese-words';

describe('numberInWords', () => {
  it.each([
    [0n, 'không'],
    [5n, 'năm'],
    [10n, 'mười'],
    [15n, 'mười lăm'],
    [21n, 'hai mươi mốt'],
    [24n, 'hai mươi tư'],
    [25n, 'hai mươi lăm'],
    [11n, 'mười một'],
    [105n, 'một trăm lẻ năm'],
    [110n, 'một trăm mười'],
    [1_000n, 'một nghìn'],
    [1_005n, 'một nghìn không trăm lẻ năm'],
    [1_000_005n, 'một triệu không trăm lẻ năm'],
    [1_250_000n, 'một triệu hai trăm năm mươi nghìn'],
    [2_000_000_000n, 'hai tỷ'],
    [1_000_000_000_000n, 'một nghìn tỷ'],
    [
      17_456_632_500n,
      'mười bảy tỷ bốn trăm năm mươi sáu triệu sáu trăm ba mươi hai nghìn năm trăm',
    ],
  ])('%s is %s', (value, words) => {
    expect(numberInWords(value)).toBe(words);
  });
});

describe('amountInVietnameseWords', () => {
  it('writes a dong total the way an invoice carries it', () => {
    expect(amountInVietnameseWords(495_000_000n, 'VND')).toBe('Bốn trăm chín mươi lăm triệu đồng');
  });

  it('writes dollars and cents', () => {
    expect(amountInVietnameseWords(4_000_50n, 'USD')).toBe('Bốn nghìn đô la Mỹ và năm mươi xu');
  });
});
