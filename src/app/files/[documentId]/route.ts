import { viewerServices } from '@/server/container';
import { documentResponse } from '@/server/http/documents';

type Params = { documentId: string };

/**
 * A document, for the person looking at the ledger it belongs to.
 *
 * The same row-level security that scopes every page scopes this: the
 * services are bound to the viewer's tenant, and a document of another
 * tenant is simply not found.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  const { documentId } = await context.params;
  const { services } = await viewerServices();
  const content = await services.documents.content(documentId);
  if (!content) return new Response('Not found', { status: 404 });
  return documentResponse(content, request);
}
