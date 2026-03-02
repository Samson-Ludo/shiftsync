import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { CurrentUser, UserRole, me } from '@/lib/api';
import { clearToken, getToken } from '@/lib/api/auth';
import { connectSocketWithStoredToken } from '@/lib/socket';

type UseRequireAuthOptions = {
  allowedRoles?: UserRole[];
  redirectTo?: string;
};

const roleRedirect = (role: UserRole): string => {
  if (role === 'staff') {
    return '/staff';
  }

  return '/manager';
};

export const useRequireAuth = (options: UseRequireAuthOptions = {}) => {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const allowedRolesKey = useMemo(
    () => (options.allowedRoles ? options.allowedRoles.join(',') : ''),
    [options.allowedRoles],
  );

  useEffect(() => {
    let active = true;

    const run = async () => {
      const token = getToken();
      if (!token) {
        if (active) {
          setLoading(false);
          void router.replace(options.redirectTo ?? '/login');
        }
        return;
      }

      try {
        const currentUser = await me();

        if (!active) {
          return;
        }

        if (options.allowedRoles && !options.allowedRoles.includes(currentUser.role)) {
          setLoading(false);
          void router.replace(roleRedirect(currentUser.role));
          return;
        }

        connectSocketWithStoredToken();
        setUser(currentUser);
      } catch {
        if (!active) {
          return;
        }

        clearToken();
        void router.replace(options.redirectTo ?? '/login');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [allowedRolesKey, options.allowedRoles, options.redirectTo, router]);

  return {
    user,
    loading,
  };
};
