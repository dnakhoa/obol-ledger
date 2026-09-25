import { defineRoute } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { documentResponse } from '@/server/http/documents';

type Params = { documentId: string };

/** The file as it was uploaded, byte for byte. `?download=1` saves rather than shows it. */
export const GET = defineRoute<Params>(
  { name: 'documents.content' },
  async ({ params, request, requestId, services }) => {
    const content = await services.documents.content(params.documentId);
    return content
      ? documentResponse(content, request)
      : problemResponse(
          problemFor({ code: 'document_not_found', documentId: params.documentId }, requestId),
        );
  },
);
