/**
 * The one thing every screen here needs and no prototype ever has. Deliberately
 * takes no colour or variant props: everything resolves through tokens so a
 * designer can restyle every empty state in the app from one place.
 */
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-base font-medium text-card-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
