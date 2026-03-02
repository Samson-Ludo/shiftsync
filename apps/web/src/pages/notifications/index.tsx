import Link from 'next/link';
import { NotificationCenter } from '@/components/notification-center';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

export default function NotificationsPage() {
  const { user, loading } = useRequireAuth();

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading notifications...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="panel flex items-center justify-between p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notification Center</p>
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-ink">
            {user.firstName} {user.lastName}
          </h1>
        </div>
        <Link href="/dashboard" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          Back to Dashboard
        </Link>
      </header>

      <NotificationCenter />
    </main>
  );
}
