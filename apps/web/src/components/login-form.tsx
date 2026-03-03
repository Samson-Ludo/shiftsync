import { FormEvent, useState } from 'react';
import { useRouter } from 'next/router';
import { ApiError, login } from '@/lib/api';
import { setToken } from '@/lib/api/auth';
import { connectSocketWithStoredToken } from '@/lib/socket';

const routeAfterLogin = (role: 'admin' | 'manager' | 'staff'): string => {
  if (role === 'staff') {
    return '/staff';
  }

  if (role === 'manager') {
    return '/manager';
  }

  return '/dashboard';
};

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

    try {
      const payload = await login(email, password);
      setToken(payload.token);
      connectSocketWithStoredToken();
      await router.push(routeAfterLogin(payload.user.role));
    } catch (error) {
      if (error instanceof ApiError) {
        setError(error.message || 'Unable to sign in');
      } else {
        setError('Unable to reach the server. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-ink">
        Log In
      </h2>
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
