import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    if (user.role === 'staff') {
      void router.replace('/staff');
      return;
    }

    if (user.role === 'manager') {
      void router.replace('/manager');
      return;
    }

    void router.replace('/dashboard');
  }, [loading, router, user]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
      <section className="panel w-full p-8 text-center">
        <p className="text-sm text-slate-600">Loading your workspace...</p>
      </section>
    </main>
  );
}
