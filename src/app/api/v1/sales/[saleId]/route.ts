import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { presentSale } from '@/server/http/stock';

type Params = { saleId: string };

/** One invoice, with what each line was sold for, what it cost, and which lots it left from. */
export const GET = defineRoute<Params>(
  { name: 'sales.get' },
  async ({ params, requestId, services }) => {
    const sale = await services.sales.get(params.saleId);
    return sale
      ? json({ data: presentSale(sale) })
      : problemResponse(problemFor({ code: 'sale_not_found', saleId: params.saleId }, requestId));
  },
);
