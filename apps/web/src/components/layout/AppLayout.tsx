import { PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Menu } from 'lucide-react';
import { CurrentUser } from '@/lib/api';
import { clearToken } from '@/lib/api/auth';
import { disconnectSocket } from '@/lib/socket';
import { Sidebar } from '@/components/navigation/Sidebar';
import { getPageTitle } from '@/components/navigation/nav-config';

type AppLayoutProps = PropsWithChildren<{
  user: CurrentUser;
}>;

const roleLabel = (role: CurrentUser['role']): string => role.charAt(0).toUpperCase() + role.slice(1);

export function AppLayout({ user, children }: AppLayoutProps) {
  const router = useRouter();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [router.asPath]);

  const pageTitle = useMemo(
    () => getPageTitle(user.role, router.pathname, router.asPath),
    [router.asPath, router.pathname, user.role],
  );

  const handleLogout = useCallback(() => {
    clearToken();
    disconnectSocket();
    void router.replace('/login');
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50/70">
      <div className="mx-auto flex min-h-screen w-full max-w-[1700px]">
        <Sidebar
          user={user}
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onLogout={handleLogout}
        />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur">
            <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Open navigation"
                  className="rounded-md border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sea md:hidden"
                  onClick={() => setIsMobileSidebarOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Workspace</p>
                  <h1 className="font-[family-name:var(--font-heading)] text-lg font-semibold text-ink">
                    {pageTitle}
                  </h1>
                </div>
              </div>

              <div className="text-right">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-xs text-slate-500">{roleLabel(user.role)}</p>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
