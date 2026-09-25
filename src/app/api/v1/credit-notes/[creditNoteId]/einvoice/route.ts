import { z } from 'zod';
import { defineRoute, json, readJson } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { creditNoteId: string };

const issueSchema = z.object({ issuedOn: z.iso.date().optional() }).default({});

/**
 * Issues the adjustment e-invoice for a credit note: it names the original
 * invoice and carries the reduction as negative amounts. The sale's own
 * e-invoice must have been issued first.
 */
export const POST = defineRoute<Params>(
  { name: 'creditNotes.einvoice.issue', auth: true },
  async ({ params, request, requestId, services }) => {
    const body = await readJson(request, issueSchema, requestId);
    if (!body.ok) return body.response;
    const result = await services.einvoices.issueForCreditNote({
      creditNoteId: params.creditNoteId,
      issuedOn: body.data.issuedOn,
    });
    return result.ok
      ? json(
          { data: result.value },
          { status: 201, headers: { location: `/api/v1/einvoices/${result.value.id}/xml` } },
        )
      : problemResponse(problemFor(result.error, requestId));
  },
);
