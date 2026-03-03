import { StaffDashboard } from '@/components/staff-dashboard';
import { AppLayout } from '@/components/layout/AppLayout';
import { UserRole } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';

const staffRoles: UserRole[] = ['staff'];

export default function StaffPage() {
  const { user, loading } = useRequireAuth({ allowedRoles: staffRoles });

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading staff workspace...</p>
        </section>
      </main>
    );
  }

  return (
    <AppLayout user={user}>
      <StaffDashboard user={user} />
    </AppLayout>
  );
}
