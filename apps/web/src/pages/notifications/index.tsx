import { NotificationCenter } from '@/components/notification-center';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/skeleton/PageSkeleton';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

export default function NotificationsPage() {
  const { user, loading } = useRequireAuth();

  if (loading || !user) {
    return <PageSkeleton withLayout sectionCount={1} />;
  }

  return (
    <AppLayout
      user={user}
      title="Notifications"
      subtitle="Real-time alerts and delivery preferences."
    >
      <NotificationCenter mode="full" initialPreference={user.notificationPreference} />
    </AppLayout>
  );
}
