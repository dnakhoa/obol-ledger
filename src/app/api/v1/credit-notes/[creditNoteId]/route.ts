import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { presentCreditNote } from '@/server/http/stock';

type Params = { creditNoteId: string };

/** One credit note, with what each line returned and credited. */
export const GET = defineRoute<Params>(
  { name: 'creditNotes.get' },
  async ({ params, requestId, services }) => {
    const note = await services.creditNotes.get(params.creditNoteId);
    return note
      ? json({ data: presentCreditNote(note) })
      : problemResponse(
          problemFor(
            { code: 'credit_note_not_found', creditNoteId: params.creditNoteId },
            requestId,
          ),
        );
  },
);
