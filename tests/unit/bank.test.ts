import { describe, expect, it } from 'vitest';
import { readStatement, suggestMatches } from '@/server/domain/bank';

describe('readStatement', () => {
  it('reads a Vietnamese bank export with money-in and money-out columns', () => {
    const csv = [
      'Ngày giao dịch,Số tham chiếu,Số tiền ghi nợ,Số tiền ghi có,Số dư,Nội dung giao dịch',
      '02/09/2026,FT2609020001,,"495,000,000","1,495,000,000",CTY XD HOA BINH TT HD-0001',
      '03/09/2026,FT2609030002,"12,500",,"1,494,987,500",Phi chuyen tien',
      ',,,,,Tong cong',
    ].join('\n');
    const read = readStatement(csv, 'VND');
    expect(read).toMatchObject({
      ok: true,
      problems: [],
      rows: [
        {
          row: 2,
          occurredOn: '2026-09-02',
          amount: 495_000_000n,
          reference: 'FT2609020001',
          balance: 1_495_000_000n,
          description: 'CTY XD HOA BINH TT HD-0001',
        },
        { row: 3, occurredOn: '2026-09-03', amount: -12_500n, description: 'Phi chuyen tien' },
      ],
    });
  });

  it('reads a Japanese export, year-first, with a signed amount column', () => {
    const csv = ['日付\t摘要\t金額\t残高', '2026/09/25\t振込 ミツイ\t-120,000\t880,000'].join('\n');
    expect(readStatement(csv, 'JPY')).toMatchObject({
      ok: true,
      rows: [{ occurredOn: '2026-09-25', amount: -120_000n, balance: 880_000n }],
    });
  });

  it('names the rows it cannot read instead of dropping them', () => {
    const csv = [
      'Date,Description,Debit,Credit',
      '31/02/2026,Rent,1000.00,',
      '01/03/2026,Refund,abc,',
      '02/03/2026,Both,5.00,6.00',
    ].join('\n');
    expect(readStatement(csv, 'AUD')).toMatchObject({
      ok: true,
      rows: [],
      problems: [
        { row: 2, problem: 'date', value: '31/02/2026' },
        { row: 3, problem: 'amount', value: 'abc' },
        { row: 4, problem: 'both_sides' },
      ],
    });
  });

  it('says which columns it could not find', () => {
    expect(readStatement('Foo,Bar\n1,2', 'USD')).toEqual({
      ok: false,
      missing: ['date', 'amount', 'description'],
    });
  });

  it('tells two identical lines apart, and the same file apart from itself', () => {
    const csv = [
      'Date,Description,Amount',
      '01/09/2026,Coffee,-4.50',
      '01/09/2026,Coffee,-4.50',
    ].join('\n');
    const first = readStatement(csv, 'AUD');
    const again = readStatement(csv, 'AUD');
    if (!first.ok || !again.ok) throw new Error('read');
    expect(new Set(first.rows.map((row) => row.fingerprint)).size).toBe(2);
    expect(again.rows.map((row) => row.fingerprint)).toEqual(
      first.rows.map((row) => row.fingerprint),
    );
  });
});

describe('suggestMatches', () => {
  it('proposes the nearest posting of the same amount, when each is the other’s nearest', () => {
    const suggestions = suggestMatches(
      [
        { id: 'l_sep', on: '2026-09-01', amount: -2_000n },
        { id: 'l_oct', on: '2026-10-01', amount: -2_000n },
        { id: 'l_fee', on: '2026-09-03', amount: -5n },
      ],
      [
        { id: 'p_sep', on: '2026-08-31', amount: -2_000n },
        { id: 'p_oct', on: '2026-09-30', amount: -2_000n },
        { id: 'p_other', on: '2026-09-03', amount: -6n },
      ],
    );
    expect(suggestions).toEqual([
      { lineId: 'l_sep', candidates: ['p_sep'], suggested: 'p_sep' },
      { lineId: 'l_oct', candidates: ['p_oct'], suggested: 'p_oct' },
      { lineId: 'l_fee', candidates: [], suggested: null },
    ]);
  });

  it('leaves two identical transfers on one day for a person to pair', () => {
    const suggestions = suggestMatches(
      [
        { id: 'l1', on: '2026-09-01', amount: 100n },
        { id: 'l2', on: '2026-09-01', amount: 100n },
      ],
      [
        { id: 'p1', on: '2026-09-01', amount: 100n },
        { id: 'p2', on: '2026-09-01', amount: 100n },
      ],
    );
    expect(suggestions.map((s) => s.suggested)).toEqual([null, null]);
    expect(suggestions[0]?.candidates).toEqual(['p1', 'p2']);
  });

  it('does not reach further than two weeks', () => {
    expect(
      suggestMatches(
        [{ id: 'l', on: '2026-09-30', amount: 1n }],
        [{ id: 'p', on: '2026-09-15', amount: 1n }],
      )[0],
    ).toEqual({ lineId: 'l', candidates: [], suggested: null });
  });
});
