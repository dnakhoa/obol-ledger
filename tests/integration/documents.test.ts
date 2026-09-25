import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { createOrganization, openAccount, servicesFor } from '../helpers/fixtures';
import { documents } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import { MAX_DOCUMENT_BYTES } from '@/server/domain/document';

/**
 * Documents: the supplier invoice behind a purchase, the customs declaration
 * behind a container.
 *
 * What is proved is what a shared drive gets wrong: the file is kept exactly
 * as it arrived and its fingerprint is checked by the database, the same
 * invoice uploaded twice is one document, a file is judged by what it is
 * rather than what it is called, nothing is ever deleted, and one tenant's
 * paperwork is invisible to another.
 */
describe('documents', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let entryId: string;
  let otherEntryId: string;

  const text = (value: string) => new TextEncoder().encode(value);
  const pdf = (body = 'invoice PI-2207') =>
    text(`%PDF-1.4\n% ${body}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    const bank = await openAccount(db, db.$orgId, { name: 'Bank', type: 'asset' });
    const stock = await openAccount(db, db.$orgId, { name: 'Stock', type: 'asset' });
    const funding = await openAccount(db, db.$orgId, {
      name: 'Owner',
      type: 'equity',
      overdraftAllowed: true,
    });
    const funded = await services.journal.postEntry({
      description: 'Capital',
      currency: 'USD',
      postings: [
        { accountId: bank.id, amount: 100_00n as never },
        { accountId: funding.id, amount: -100_00n as never },
      ],
    });
    if (!funded.ok) throw new Error(funded.error.code);
    otherEntryId = funded.value.transaction.id;
    const bought = await services.journal.postEntry({
      description: 'Pavers from Bình Định',
      currency: 'USD',
      postings: [
        { accountId: stock.id, amount: 40_00n as never },
        { accountId: bank.id, amount: -40_00n as never },
      ],
    });
    if (!bought.ok) throw new Error(bought.error.code);
    entryId = bought.value.transaction.id;
  });

  it('keeps the file exactly, and lists it on the entry it supports', async () => {
    const bytes = pdf();
    const attached = await services.documents.attach({
      transactionId: entryId,
      filename: 'C:\\Scans\\Hóa đơn PI-2207.PDF',
      bytes,
      kind: 'invoice',
      note: 'Supplier invoice',
    });
    if (!attached.ok) throw new Error(attached.error.code);
    expect(attached.value).toMatchObject({
      filename: 'Hóa đơn PI-2207.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      kind: 'invoice',
      note: 'Supplier invoice',
      transactionId: entryId,
    });

    const listed = await services.documents.list({ transactionId: entryId });
    expect(listed.map((a) => a.id)).toEqual([attached.value.id]);

    const content = await services.documents.content(attached.value.documentId);
    expect(content?.contentType).toBe('application/pdf');
    expect(Buffer.from(content?.bytes ?? []).equals(Buffer.from(bytes))).toBe(true);
  });

  it('stores the same invoice once, however often it is attached', async () => {
    const first = await services.documents.attach({
      transactionId: entryId,
      filename: 'a.pdf',
      bytes: pdf(),
      kind: 'invoice',
    });
    const again = await services.documents.attach({
      transactionId: entryId,
      filename: 'copy of a.pdf',
      bytes: pdf(),
      kind: 'invoice',
    });
    const elsewhere = await services.documents.attach({
      transactionId: otherEntryId,
      filename: 'a.pdf',
      bytes: pdf(),
      kind: 'receipt',
    });
    if (!first.ok || !again.ok || !elsewhere.ok) throw new Error('attach');

    // A retried upload is the attachment it already was.
    expect(again.value.id).toBe(first.value.id);
    expect(elsewhere.value.id).not.toBe(first.value.id);
    expect(elsewhere.value.documentId).toBe(first.value.documentId);

    const [row] = await withTenant(db, db.$orgId, (tx) =>
      tx.select({ count: sql<number>`count(*)::int` }).from(documents),
    );
    expect(row?.count).toBe(1);
  });

  it('judges a file by what it is, not what it is called', async () => {
    const refused = async (filename: string, bytes: Uint8Array) =>
      services.documents.attach({ transactionId: entryId, filename, bytes, kind: 'other' });

    expect(
      await refused('invoice.pdf', text('<html><script>alert(1)</script></html>')),
    ).toMatchObject({
      ok: false,
      error: { code: 'document_type_not_allowed', filename: 'invoice.pdf' },
    });
    expect(
      await refused(
        'logo.xml',
        text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'),
      ),
    ).toMatchObject({ ok: false, error: { code: 'document_type_not_allowed' } });
    expect(
      await refused(
        'bomb.xml',
        text('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY a "aaaa">]><HDon>&a;</HDon>'),
      ),
    ).toMatchObject({ ok: false, error: { code: 'document_type_not_allowed' } });
    expect(await refused('empty.pdf', new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: 'document_empty' },
    });
    const huge = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    huge.set(pdf());
    expect(await refused('huge.pdf', huge)).toMatchObject({
      ok: false,
      error: { code: 'document_too_large', limitBytes: MAX_DOCUMENT_BYTES },
    });

    // An e-invoice is welcome, whatever it was called.
    const einvoice = await refused(
      'hoadon',
      text('\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<HDon><DLHDon/></HDon>'),
    );
    expect(einvoice).toMatchObject({
      ok: true,
      value: { contentType: 'application/xml', filename: 'hoadon.xml' },
    });
  });

  it('attaches the customs declaration to its shipment', async () => {
    const shipment = await services.landedCost.record({ reference: 'MSKU-2207' });
    if (!shipment.ok) throw new Error(shipment.error.code);
    const attached = await services.documents.attach({
      shipmentId: shipment.value.id,
      filename: 'To khai.pdf',
      bytes: pdf('customs'),
      kind: 'customs_declaration',
    });
    expect(attached).toMatchObject({ ok: true, value: { shipmentId: shipment.value.id } });

    const missing = await services.documents.attach({
      shipmentId: 'ship_missing',
      filename: 'x.pdf',
      bytes: pdf(),
      kind: 'other',
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'shipment_not_found' } });
  });

  it('takes an attachment off without losing that it was there', async () => {
    const attached = await services.documents.attach({
      transactionId: entryId,
      filename: 'wrong.pdf',
      bytes: pdf('wrong'),
      kind: 'invoice',
    });
    if (!attached.ok) throw new Error(attached.error.code);

    expect((await services.documents.detach(attached.value.id)).ok).toBe(true);
    expect(await services.documents.list({ transactionId: entryId })).toEqual([]);
    expect(await services.documents.detach(attached.value.id)).toMatchObject({
      ok: false,
      error: { code: 'document_link_not_found' },
    });
    // The file itself is still held, and can be attached again.
    expect(await services.documents.content(attached.value.documentId)).not.toBeNull();
    const back = await services.documents.attach({
      transactionId: entryId,
      filename: 'wrong.pdf',
      bytes: pdf('wrong'),
      kind: 'invoice',
    });
    expect(back.ok && back.value.id !== attached.value.id).toBe(true);
  });

  it('is refused by the database when a writer goes around the service', async () => {
    const attached = await services.documents.attach({
      transactionId: entryId,
      filename: 'a.pdf',
      bytes: pdf(),
      kind: 'invoice',
    });
    if (!attached.ok) throw new Error(attached.error.code);
    const { documentId, id: linkId } = attached.value;

    // A fingerprint that is not the content's.
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`
          INSERT INTO documents (id, org_id, sha256, filename, content_type, size_bytes, content)
          VALUES ('doc_forged', ${db.$orgId}, ${'0'.repeat(64)}, 'x.pdf', 'application/pdf', 5,
                  '\\x255044462d'::bytea)
        `),
      ),
      /documents_content_check/,
    );
    // A type the service would never have written.
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`
          INSERT INTO documents (id, org_id, sha256, filename, content_type, size_bytes, content)
          VALUES ('doc_html', ${db.$orgId}, encode(sha256('\\x3c68746d6c3e'::bytea), 'hex'),
                  'x.html', 'text/html', 6, '\\x3c68746d6c3e'::bytea)
        `),
      ),
      /documents_content_check/,
    );
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`UPDATE documents SET filename = 'other.pdf' WHERE id = ${documentId}`),
      ),
      /append-only/,
    );
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`DELETE FROM document_links WHERE id = ${linkId}`),
      ),
      /append-only/,
    );
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`UPDATE document_links SET kind = 'receipt' WHERE id = ${linkId}`),
      ),
      /append-only/,
    );
  });

  it('keeps one tenant’s paperwork out of another’s sight', async () => {
    const attached = await services.documents.attach({
      transactionId: entryId,
      filename: 'a.pdf',
      bytes: pdf(),
      kind: 'invoice',
    });
    if (!attached.ok) throw new Error(attached.error.code);

    const stranger = servicesFor(db, await createOrganization(db, 'stranger'));
    expect(await stranger.documents.content(attached.value.documentId)).toBeNull();
    expect(await stranger.documents.attachment(attached.value.id)).toBeNull();
    // Nor can it attach to an entry it cannot see.
    expect(
      await stranger.documents.attach({
        transactionId: entryId,
        filename: 'b.pdf',
        bytes: pdf('b'),
        kind: 'invoice',
      }),
    ).toMatchObject({ ok: false, error: { code: 'entry_not_found' } });
  });
});
