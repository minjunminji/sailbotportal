import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';

export const metadata: Metadata = {
  title: 'Apply | UBC Sailbot hiring',
};

export default function ApplyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Apply to UBC Sailbot</h1>
      <p className="mt-3 text-base text-muted-foreground">
        One application covers every team. You answer a short set of shared questions, rank the
        subteams you want, and then answer the questions those teams ask.
      </p>

      <div className="mt-8">
        <EmptyState
          title="The application form is not ready yet"
          description="There is nothing to fill in on this page so far. The open postings on the home page are the current source of truth for what each team is looking for."
        />
      </div>

      <Link
        href="/"
        className="mt-6 inline-block rounded-md px-2 py-1 text-base underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Back to open postings
      </Link>
    </main>
  );
}
