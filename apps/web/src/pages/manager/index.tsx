import { ManagerDashboard } from '@/components/manager-dashboard';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/skeleton/PageSkeleton';
import { UserRole } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

const managerRoles: UserRole[] = ['admin', 'manager'];

export default function ManagerPage() {
  const { user, loading } = useRequireAuth({ allowedRoles: managerRoles });

  if (loading || !user) {
    return <PageSkeleton withLayout showToolbar sectionCount={2} />;
  }

  return (
    <AppLayout
      user={user}
      title="Manager Dashboard"
      subtitle="Plan schedules, validate assignments, and resolve coverage requests."
    >
      <ManagerDashboard user={user} />
    </AppLayout>
  );
}
