import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/safe-next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in | Sailbot Hiring Portal',
};

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next } = await searchParams;

  // Validated here, on the server, so the browser never sees an off-site
  // destination even if one was in the link that got clicked.
  const destination = safeNextPath(next);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          For team leads and admins. Accounts are created by invitation, so there is nothing to sign
          up for here.
        </p>
        <LoginForm next={destination} />
      </div>
    </main>
  );
}
