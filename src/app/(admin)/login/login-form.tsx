'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

const fieldClasses =
  'mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-base ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:opacity-50';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    });

    if (signInError) {
      // One message for every failure. Telling an unauthenticated visitor that
      // an address exists but the password was wrong turns this form into an
      // account-enumeration oracle.
      setError('Invalid email or password.');
      setPending(false);
      return;
    }

    // Stay pending through the navigation; the form is gone once it lands.
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      <div>
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          className={fieldClasses}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          className={fieldClasses}
        />
      </div>

      {/* Present in the DOM before it has content, so a change is announced. */}
      <div aria-live="polite" className="mt-4 empty:mt-0">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
