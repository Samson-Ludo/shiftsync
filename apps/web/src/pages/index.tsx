import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { PageSkeleton } from '@/components/skeleton/PageSkeleton';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    if (user.role === 'staff') {
      void router.replace('/staff');
      return;
    }

    if (user.role === 'manager') {
      void router.replace('/manager');
      return;
    }

    void router.replace('/dashboard');
  }, [loading, router, user]);

  return (
    <PageSkeleton withLayout showToolbar sectionCount={2} />
  );
}
