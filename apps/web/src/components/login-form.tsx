'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('maya.manager@coastaleats.com');
  const [password, setPassword] = useState('Pass123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? 'Unable to sign in');
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h2 className="font-[var(--font-heading)] text-2xl font-semibold text-ink">Log In</h2>
      <label className="block">
        <span className="mb-1 block text-sm">Email</span>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm">Password</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button className="btn-primary w-full" type="submit" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}