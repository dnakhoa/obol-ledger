import { ScaleIcon } from '@/components/icons';

/**
 * The mark and the name, as the app's shell draws them — with the gold coin
 * the landing page is allowed and the app is not.
 */
export function Wordmark() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="bg-brand text-brand-ink flex size-7 items-center justify-center rounded-md">
        <ScaleIcon width={15} height={15} />
      </span>
      Obol
    </span>
  );
}
