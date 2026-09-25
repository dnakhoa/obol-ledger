import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { presentSupplierReturn } from '@/server/http/stock';

type Params = { supplierReturnId: string };

/** One return to a supplier: what went back, what was refunded, and what was not. */
export const GET = defineRoute<Params>(
  { name: 'supplierReturns.get' },
  async ({ params, requestId, services }) => {
    const found = await services.supplierReturns.get(params.supplierReturnId);
    return found
      ? json({ data: presentSupplierReturn(found) })
      : problemResponse(
          problemFor(
            { code: 'supplier_return_not_found', supplierReturnId: params.supplierReturnId },
            requestId,
          ),
        );
  },
);
