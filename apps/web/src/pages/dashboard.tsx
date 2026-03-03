import { ManagerDashboard } from '@/components/manager-dashboard';
import { StaffDashboard } from '@/components/staff-dashboard';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/skeleton/PageSkeleton';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();

  if (loading || !user) {
    return <PageSkeleton withLayout showToolbar sectionCount={2} />;
  }

  if (user.role === 'staff') {
    return (
      <AppLayout
        user={user}
        title="My Shifts"
        subtitle="Track assignments, swaps, and available drop coverage."
      >
        <StaffDashboard user={user} />
      </AppLayout>
    );
  }

  return (
    <AppLayout
      user={user}
      title="Dashboard"
      subtitle="Manage staffing, coverage approvals, and live operational updates."
    >
      <ManagerDashboard user={user} />
    </AppLayout>
  );
}
