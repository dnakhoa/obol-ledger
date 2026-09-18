import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="numeric text-5xl font-semibold tracking-tight">404</p>
      <div className="space-y-1">
        <h1 className="text-sm font-semibold">That page does not exist</h1>
        <p className="text-ink-muted text-xs">
          The account or entry you asked for is not in this ledger.
        </p>
      </div>
      <Link
        href="/"
        className="bg-action text-action-ink inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
      >
        Back to the overview
      </Link>
    </main>
  );
}
