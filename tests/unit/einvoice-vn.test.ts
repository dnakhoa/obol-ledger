import { describe, expect, it } from 'vitest';
import {
  buildInvoiceXml,
  invoiceNumber,
  seriesFitsYear,
  unitPrice,
  type InvoiceDocument,
} from '@/server/domain/einvoice-vn';

const invoice: InvoiceDocument = {
  kind: 'original',
  reference: { template: '1', series: 'C26TBM', number: 12, issuedOn: '2026-09-25' },
  currency: 'VND',
  exchangeRate: '1',
  paymentMethod: 'TM/CK',
  seller: {
    name: 'Công ty TNHH Đá Bình Minh',
    taxId: '4101234567',
    address: 'Quy Nhơn, Bình Định',
  },
  buyer: { name: 'Công ty Xây dựng Hòa Bình & Cộng sự', taxId: '0301234567', address: null },
  lines: [
    {
      description: 'Đá lát granite 600×600',
      unit: 'm2',
      quantity: '1500.00',
      amount: 450_000_000n,
      rate: '10%',
    },
  ],
  net: 450_000_000n,
  tax: 45_000_000n,
};

describe('buildInvoiceXml', () => {
  const xml = buildInvoiceXml(invoice);

  it('carries the reference, parties, line and totals in the national format', () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<HDon><DLHDon Id="data">/u);
    expect(xml).toContain('<KHMSHDon>1</KHMSHDon><KHHDon>C26TBM</KHHDon><SHDon>0000012</SHDon>');
    expect(xml).toContain('<NLap>2026-09-25</NLap><DVTTe>VND</DVTTe><TGia>1</TGia>');
    expect(xml).toContain('<NBan><Ten>Công ty TNHH Đá Bình Minh</Ten><MST>4101234567</MST>');
    expect(xml).toContain(
      '<THHDVu>Đá lát granite 600×600</THHDVu><DVTinh>m2</DVTinh><SLuong>1500.00</SLuong><DGia>300000</DGia><ThTien>450000000</ThTien><TSuat>10%</TSuat>',
    );
    expect(xml).toContain(
      '<TgTCThue>450000000</TgTCThue><TgTThue>45000000</TgTThue><TgTTTBSo>495000000</TgTTTBSo>',
    );
    expect(xml).toContain('<TgTTTBChu>Bốn trăm chín mươi lăm triệu đồng</TgTTTBChu>');
  });

  it('escapes what a name can contain', () => {
    expect(xml).toContain('Hòa Bình &amp; Cộng sự');
    expect(xml).not.toContain('& Cộng');
  });

  it('names the invoice an adjustment corrects', () => {
    const adjustment = buildInvoiceXml({
      ...invoice,
      kind: 'adjustment',
      reference: { ...invoice.reference, number: 13 },
      lines: [{ ...invoice.lines[0]!, quantity: '100.00', amount: -30_000_000n }],
      net: -30_000_000n,
      tax: -3_000_000n,
      adjusts: { ...invoice.reference, reason: 'Hàng bán bị trả lại theo CN-0001' },
    });
    expect(adjustment).toContain(
      '<TTHDLQuan><TCHDon>2</TCHDon><LHDCLQuan>1</LHDCLQuan><KHMSHDCLQuan>1</KHMSHDCLQuan><KHHDCLQuan>C26TBM</KHHDCLQuan><SHDCLQuan>0000012</SHDCLQuan>',
    );
    expect(adjustment).toContain('<TgTTTBSo>-33000000</TgTTTBSo>');
    expect(adjustment).toContain('<TgTTTBChu>Âm ba mươi ba triệu đồng</TgTTTBChu>');
  });
});

describe('series and numbers', () => {
  it('accepts a series only in the year it names', () => {
    expect(seriesFitsYear('C26TBM', '2026-09-25')).toBe(true);
    expect(seriesFitsYear('C25TBM', '2026-09-25')).toBe(false);
    expect(seriesFitsYear('X26TBM', '2026-09-25')).toBe(false);
    expect(seriesFitsYear('C26TB', '2026-09-25')).toBe(false);
  });

  it('prints seven digits', () => {
    expect(invoiceNumber(12)).toBe('0000012');
  });

  it('works out a unit price in integers', () => {
    expect(unitPrice(125_000n, '12.5', 'USD')).toBe('100');
    expect(unitPrice(100n, '3', 'USD')).toBe('0.333333');
    expect(unitPrice(1_000_000n, '3', 'VND')).toBe('333333.3333');
  });
});
