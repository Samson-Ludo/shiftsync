import { ManagerDashboard } from '@/components/manager-dashboard';
import { AppLayout } from '@/components/layout/AppLayout';
import { UserRole } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

const managerRoles: UserRole[] = ['admin', 'manager'];

export default function ManagerPage() {
  const { user, loading } = useRequireAuth({ allowedRoles: managerRoles });

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading manager workspace...</p>
        </section>
      </main>
    );
  }

  return (
    <AppLayout user={user}>
      <ManagerDashboard user={user} />
    </AppLayout>
  );
}
