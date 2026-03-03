import { NotificationCenter } from '@/components/notification-center';
import { AppLayout } from '@/components/layout/AppLayout';
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
    <AppLayout user={user}>
      <NotificationCenter mode="full" initialPreference={user.notificationPreference} />
    </AppLayout>
  );
}
