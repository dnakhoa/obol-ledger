'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { viewerServices } from '@/server/container';
import type { ImportPreview } from '@/server/services/stock-import';

export type ImportState = {
  readonly status: 'idle' | 'previewed' | 'error' | 'done';
  readonly message?: string;
  readonly preview?: ImportPreview;
  /** Kept so the second press does not need the file pasted again. */
  readonly text?: string;
  readonly problems?: readonly { readonly line: number; readonly problem: string }[];
};

/**
 * Look, then apply — two presses, never one.
 *
 * The person doing this is moving several hundred rows of their own history
 * into a system they have used for ten minutes. Showing them exactly what will
 * happen, line by line, with their own container numbers in it, is the whole
 * difference between a tool they trust and a tool they try once.
 *
 * The preview writes nothing and runs the same checks the apply does, so a
 * clean preview really does mean a clean import.
 */

const schema = z.object({
  text: z.string().min(1),
  creditAccountId: z.string().min(1),
  inventoryAccountId: z.string().min(1),
  cogsAccountId: z.string().min(1),
});

/**
 * Deliberately open to a signed-out visitor, unlike the apply below.
 *
 * It writes nothing, and it reads only the published demo's own product list.
 * What it gives back is the thing somebody evaluating this actually wants:
 * paste your own purchase history in and see whether it was understood —
 * whether the separator was right, whether 10/01 was read as January, whether
 * the tonnes kept their third decimal. Making them create an account to find
 * that out would be asking for trust before offering any.
 */
export async function previewImportAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const parsed = schema.safeParse(fields(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Paste the rows in, and choose where the deliveries are charged.',
    };
  }

  const { services, viewer } = await viewerServices();
  const preview = await services.stockImport.preview(parsed.data);
  const readOnly = viewer.kind !== 'member' || !viewer.canWrite;

  return {
    status: 'previewed',
    preview,
    text: parsed.data.text,
    message:
      preview.missingColumns.length > 0
        ? `This file has no ${preview.missingColumns.join(', ')} column, so there is nothing to import from it yet. Check the header row.`
        : preview.problems > 0
          ? `${preview.problems} of ${preview.rows.length} rows need fixing first. Nothing has been imported.`
          : `${preview.rows.length} deliveries ready${preview.newProducts > 0 ? `, opening ${preview.newProducts} new product${preview.newProducts === 1 ? '' : 's'}` : ''}${readOnly ? '. Sign in to import them into your own books' : '. Nothing has been imported yet'}.`,
  };
}

export async function applyImportAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = schema.safeParse(fields(formData));
  if (!parsed.success) return { status: 'error', message: 'The rows were lost. Paste them again.' };

  const result = await writer.services.stockImport.apply(parsed.data);
  revalidatePath('/stock');

  if (!result.ok) {
    // `import_has_problems` is the only refusal that carries line numbers, and
    // it is the one worth rendering row by row.
    if ('problems' in result.error) {
      return {
        status: 'error',
        text: parsed.data.text,
        problems: result.error.problems,
        message: 'Nothing was imported. Fix these rows and try again.',
      };
    }
    return { status: 'error', text: parsed.data.text, message: result.error.code };
  }

  return {
    status: 'done',
    message: `Imported ${result.value.lots} deliver${result.value.lots === 1 ? 'y' : 'ies'}${result.value.products > 0 ? `, opening ${result.value.products} new product${result.value.products === 1 ? '' : 's'}` : ''}. Each one has been posted to the ledger too.`,
  };
}

function fields(formData: FormData) {
  return {
    text: String(formData.get('text') ?? ''),
    creditAccountId: String(formData.get('creditAccountId') ?? ''),
    inventoryAccountId: String(formData.get('inventoryAccountId') ?? ''),
    cogsAccountId: String(formData.get('cogsAccountId') ?? ''),
  };
}
