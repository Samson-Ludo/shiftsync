import { ManagerDashboard } from '@/components/manager-dashboard';
import { StaffDashboard } from '@/components/staff-dashboard';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading dashboard...</p>
        </section>
      </main>
    );
  }

  if (user.role === 'staff') {
    return <StaffDashboard user={user} />;
  }

  return <ManagerDashboard user={user} />;
}
