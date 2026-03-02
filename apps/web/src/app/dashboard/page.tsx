import { redirect } from 'next/navigation';
import { fetchCurrentUser } from '@/lib/server-auth';
import { ManagerDashboard } from '@/components/manager-dashboard';
import { StaffDashboard } from '@/components/staff-dashboard';

export default async function DashboardPage() {
  const user = await fetchCurrentUser();

  if (!user) {
    redirect('/login');
  }

  if (user.role === 'manager' || user.role === 'admin') {
    return <ManagerDashboard user={user} />;
  }

  return <StaffDashboard user={user} />;
}