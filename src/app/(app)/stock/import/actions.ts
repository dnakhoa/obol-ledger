'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { viewerServices } from '@/server/container';
import { describeError, translations } from '@/server/i18n';
import type { Messages } from '@/lib/i18n';
import type { ImportPreview } from '@/server/services/stock-import';
import { headers } from 'next/headers';
import { db } from '@/server/db/client';
import { clientAddress } from '@/server/http/client-address';
import { durableRateLimit } from '@/server/http/durable-rate-limit';
import { uploadAllowed } from '@/server/http/upload-quota';

export type ImportState = {
  readonly status: 'idle' | 'previewed' | 'error' | 'done';
  readonly message?: string;
  readonly preview?: ImportPreview;
  /** Kept so the second press does not need the file pasted again. */
  readonly text?: string;
  /** Already-formatted, one per bad row. */
  readonly problems?: readonly string[];
  /**
   * The sentences that depend on the preview, formatted here.
   *
   * "Import 12 deliveries" and "columns not used: …" are messages that take
   * arguments, so in the dictionary they are functions — and a function
   * cannot cross the server/client boundary. They are resolved at the only
   * point that has both the numbers and the dictionary: here.
   */
  readonly notes?: {
    readonly separator: string;
    readonly ignoredColumns?: string;
    readonly missingColumns?: string;
    readonly importButton: string;
  };
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

/**
 * The most a paste may hold. The preview is open to signed-out visitors, and
 * each row becomes an object with its own message — so without a bound, a few
 * megabytes of blank lines would cost the server hundreds of megabytes to
 * describe. A real purchase history in one go is a few thousand rows.
 */
const MAX_ROWS = 5_000;
const MAX_CHARS = 1_000_000;

const schema = z.object({
  text: z.string().min(1).max(MAX_CHARS),
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
  const { t } = await translations();
  const decision = await durableRateLimit(
    db(),
    `import-preview:${clientAddress(await headers())}`,
    {
      limit: 30,
    },
  );
  if (!decision.allowed)
    return { status: 'error', message: t.forms.tooManyTransitions(decision.retryAfterSeconds) };

  const size = sizeOf(formData);
  if (size === 'too_large') return { status: 'error', message: t.stockImport.tooLarge(MAX_ROWS) };
  const parsed = schema.safeParse(fields(formData));
  if (!parsed.success) return { status: 'error', message: t.stockImport.pasteRows };

  const { services, viewer } = await viewerServices();
  const preview = await services.stockImport.preview(parsed.data);
  const readOnly = viewer.kind !== 'member' || !viewer.canWrite;

  return {
    status: 'previewed',
    preview,
    notes: notesFor(preview, t),
    text: parsed.data.text,
    message:
      preview.missingColumns.length > 0
        ? t.stockImport.noColumn(preview.missingColumns.join(', '))
        : preview.problems > 0
          ? t.stockImport.rowsNeedFixing(preview.problems, preview.rows.length)
          : t.stockImport.readyToImport(
              preview.rows.length,
              preview.newProducts,
              readOnly ? 'yes' : 'no',
            ),
  };
}

export async function applyImportAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

  const { locale, t } = await translations();
  if (sizeOf(formData) === 'too_large') {
    return { status: 'error', message: t.stockImport.tooLarge(MAX_ROWS) };
  }
  const quota = await uploadAllowed(writer.viewer.orgId);
  if (!quota.allowed) {
    return { status: 'error', message: t.forms.tooManyTransitions(quota.retryAfterSeconds) };
  }
  const parsed = schema.safeParse(fields(formData));
  if (!parsed.success) return { status: 'error', message: t.stockImport.rowsLost };

  const result = await writer.services.stockImport.apply(parsed.data);
  revalidatePath('/stock');

  if (!result.ok) {
    // `import_has_problems` is the only refusal that carries line numbers, and
    // it is the one worth rendering row by row.
    if ('problems' in result.error) {
      return {
        status: 'error',
        text: parsed.data.text,
        problems: result.error.problems.map((problem) =>
          t.stockImport.rowProblem(problem.line, problem.problem),
        ),
        message: t.stockImport.importFailed,
      };
    }
    // Anything else is an ordinary refusal from the ledger — a closed
    // period, a missing rate — and reads like one, in the reader's language.
    // It used to be shown as its bare code.
    return {
      status: 'error',
      text: parsed.data.text,
      message: describeError(result.error, locale),
    };
  }

  return {
    status: 'done',
    message: t.stockImport.imported(result.value.lots, result.value.products),
  };
}

const SEPARATOR_NOTE: Record<ImportPreview['separator'], keyof Messages['stockImport']> = {
  tab: 'separatorTab',
  semicolon: 'separatorSemicolon',
  comma: 'separatorComma',
};

function notesFor(preview: ImportPreview, t: Messages): NonNullable<ImportState['notes']> {
  return {
    separator: String(t.stockImport[SEPARATOR_NOTE[preview.separator]]),
    ...(preview.ignoredColumns.length > 0
      ? { ignoredColumns: t.stockImport.ignoredColumns(preview.ignoredColumns.join(', ')) }
      : {}),
    ...(preview.missingColumns.length > 0
      ? { missingColumns: t.stockImport.missingColumnsInline(preview.missingColumns.join(', ')) }
      : {}),
    importButton: t.stockImport.importButton(preview.rows.length),
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

/** Refused before parsing, so an oversized paste costs a count, not a parse. */
function sizeOf(formData: FormData): 'ok' | 'too_large' {
  const text = formData.get('text');
  if (typeof text !== 'string') return 'ok';
  if (text.length > MAX_CHARS) return 'too_large';
  let lines = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    lines += 1;
    if (lines > MAX_ROWS + 1) return 'too_large';
  }
  return 'ok';
}
