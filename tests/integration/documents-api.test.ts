import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { setDatabaseForTesting } from '@/server/db/client';
import { resetRateLimits } from '@/server/http/rate-limit';
import { apiKeys, organizations } from '@/server/db/schema';
import { digestToken } from '@/server/services/authentication';
import { newId } from '@/lib/id';
import {
  GET as listDocuments,
  POST as attachDocument,
} from '@/app/api/v1/entries/[entryId]/documents/route';
import { DELETE as removeDocument } from '@/app/api/v1/entries/[entryId]/documents/[linkId]/route';
import { GET as documentContent } from '@/app/api/v1/documents/[documentId]/content/route';

/**
 * Documents over HTTP: a multipart upload, the file coming back exactly as
 * it went in and served so it cannot run, a key required to write, and a
 * disguised file refused with the ordinary problem document.
 */
const TOKEN = 'test-token';

describe('documents API', () => {
  let db: TestDatabase;
  let entryId: string;

  const upload = (file: Blob, name: string, kind = 'invoice', token: string | null = TOKEN) => {
    const form = new FormData();
    form.set('file', file, name);
    form.set('kind', kind);
    return attachDocument(
      new Request(`https://ledger.test/api/v1/entries/${entryId}/documents`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      }),
      { params: Promise.resolve({ entryId }) },
    );
  };

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
    resetRateLimits();
    await db.update(organizations).set({ isDemo: true }).where(eq(organizations.id, db.$orgId));
    await db.insert(apiKeys).values({
      id: newId('apiKey'),
      orgId: db.$orgId,
      name: 'test key',
      tokenDigest: digestToken(TOKEN),
      tokenPrefix: TOKEN.slice(0, 6),
    });
    const bank = await openAccount(db, db.$orgId, { name: 'Bank', type: 'asset' });
    const owner = await openAccount(db, db.$orgId, {
      name: 'Owner',
      type: 'equity',
      overdraftAllowed: true,
    });
    const entry = await servicesFor(db, db.$orgId).journal.postEntry({
      description: 'Capital',
      currency: 'USD',
      postings: [
        { accountId: bank.id, amount: 10_00n as never },
        { accountId: owner.id, amount: -10_00n as never },
      ],
    });
    if (!entry.ok) throw new Error(entry.error.code);
    entryId = entry.value.transaction.id;
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  it('attaches, lists, serves and removes a file', async () => {
    const pdf = new Blob(['%PDF-1.4\n% bank advice\n%%EOF\n']);
    const created = await upload(pdf, 'Giấy báo có.pdf', 'receipt');
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as {
      data: { id: string; documentId: string; contentType: string };
    };
    expect(data.contentType).toBe('application/pdf');

    const listed = await listDocuments(
      new Request(`https://ledger.test/api/v1/entries/${entryId}/documents`),
      { params: Promise.resolve({ entryId }) },
    );
    expect(((await listed.json()) as { data: unknown[] }).data).toHaveLength(1);

    const served = await documentContent(
      new Request(`https://ledger.test/api/v1/documents/${data.documentId}/content`),
      { params: Promise.resolve({ documentId: data.documentId }) },
    );
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('application/pdf');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''Gi%E1%BA%A5y%20b%C3%A1o%20c%C3%B3.pdf",
    );
    expect(await served.text()).toBe('%PDF-1.4\n% bank advice\n%%EOF\n');

    const removed = await removeDocument(
      new Request(`https://ledger.test/api/v1/entries/${entryId}/documents/${data.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      { params: Promise.resolve({ entryId, linkId: data.id }) },
    );
    expect(removed.status).toBe(204);
  });

  it('refuses a disguised file, an unknown kind, and a writer without a key', async () => {
    const disguised = await upload(new Blob(['<html><script></script></html>']), 'invoice.pdf');
    expect(disguised.status).toBe(415);
    expect(((await disguised.json()) as { code: string }).code).toBe('document_type_not_allowed');

    const unknownKind = await upload(new Blob(['%PDF-1.4']), 'a.pdf', 'selfie');
    expect(unknownKind.status).toBe(422);

    const anonymous = await upload(new Blob(['%PDF-1.4']), 'a.pdf', 'invoice', null);
    expect(anonymous.status).toBe(401);
  });
});
