import { StaffDashboard } from '@/components/staff-dashboard';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/skeleton/PageSkeleton';
import { UserRole } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

const staffRoles: UserRole[] = ['staff'];

export default function StaffPage() {
  const { user, loading } = useRequireAuth({ allowedRoles: staffRoles });

  if (loading || !user) {
    return <PageSkeleton withLayout showToolbar sectionCount={3} />;
  }

  return (
    <AppLayout
      user={user}
      title="My Shifts"
      subtitle="Track assignments, request swaps, and claim available coverage."
    >
      <StaffDashboard user={user} />
    </AppLayout>
  );
}
