'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Client-side only so the current section can be marked. `aria-current` is the
 * part that matters: without it a screen reader user has no way to tell which
 * board they are looking at.
 */
export function AdminNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const isCurrent = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'block rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
        isCurrent ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}
