import { defineRoute } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { entryId: string; linkId: string };

/**
 * Takes an attachment off an entry.
 *
 * The file and the record that it was once attached both stay: this marks
 * the link removed, which is as far as anything in the ledger is deleted.
 */
export const DELETE = defineRoute<Params>(
  { name: 'entries.documents.remove', auth: true },
  async ({ params, requestId, services }) => {
    const attachment = await services.documents.attachment(params.linkId);
    if (!attachment || attachment.transactionId !== params.entryId) {
      return problemResponse(
        problemFor({ code: 'document_link_not_found', linkId: params.linkId }, requestId),
      );
    }
    const removed = await services.documents.detach(params.linkId);
    return removed.ok
      ? new Response(null, { status: 204 })
      : problemResponse(problemFor(removed.error, requestId));
  },
);
