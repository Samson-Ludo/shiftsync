import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { LoginForm } from '@/components/login-form';
import { clearToken, getToken } from '@/lib/api/auth';
import { me } from '@/lib/api';

const routeAfterLogin = (role: 'admin' | 'manager' | 'staff'): string => {
  if (role === 'staff') {
    return '/staff';
  }

  if (role === 'manager') {
    return '/manager';
  }

  return '/dashboard';
};

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const check = async () => {
      if (!getToken()) {
        return;
      }

      try {
        const currentUser = await me();
        if (active) {
          void router.replace(routeAfterLogin(currentUser.role));
        }
      } catch {
        clearToken();
      }
    };

    void check();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-6">
      <section className="panel grid w-full max-w-3xl grid-cols-1 overflow-hidden lg:grid-cols-2">
        <div className="bg-ink p-8 text-sand">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Coastal Eats</p>
          <h1 className="mt-3 text-3xl font-semibold">ShiftSync</h1>
          <p className="mt-3 text-sm text-slate-100/85">
            Multi-location scheduling across LA and New York. Log in as Admin, Manager, or Staff.
          </p>
        </div>
        <div className="p-8">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
