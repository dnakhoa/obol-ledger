import { z } from 'zod';
import { defineRoute, json, readJson } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { saleId: string };

/** The e-invoice for a sale and the adjustments to it, in number order. */
export const GET = defineRoute<Params>(
  { name: 'sales.einvoices.list' },
  async ({ params, services }) => json({ data: await services.einvoices.forSale(params.saleId) }),
);

const issueSchema = z.object({ issuedOn: z.iso.date().optional() }).default({});

/**
 * Issues the Vietnamese e-invoice for a sale: the next number in the
 * company's series, naming seller and buyer as the law requires. Issued once;
 * a second request is a 409 naming the one already issued.
 */
export const POST = defineRoute<Params>(
  { name: 'sales.einvoices.issue', auth: true },
  async ({ params, request, requestId, services }) => {
    const body = await readJson(request, issueSchema, requestId);
    if (!body.ok) return body.response;
    const result = await services.einvoices.issueForSale({
      saleId: params.saleId,
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
