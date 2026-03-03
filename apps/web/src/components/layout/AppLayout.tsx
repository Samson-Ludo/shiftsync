import { PropsWithChildren, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Menu } from 'lucide-react';
import { CurrentUser } from '@/lib/api';
import { clearToken } from '@/lib/api/auth';
import { disconnectSocket } from '@/lib/socket';
import { Sidebar } from '@/components/navigation/Sidebar';
import { getPageTitle } from '@/components/navigation/nav-config';

type AppLayoutProps = PropsWithChildren<{
  user: CurrentUser;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  ariaBusy?: boolean;
}>;

const roleLabel = (role: CurrentUser['role']): string => role.charAt(0).toUpperCase() + role.slice(1);

export function AppLayout({ user, title, subtitle, actions, ariaBusy = false, children }: AppLayoutProps) {
  const router = useRouter();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [router.asPath]);

  const pageTitle = useMemo(() => title ?? getPageTitle(user.role, router.pathname, router.asPath), [
    router.asPath,
    router.pathname,
    title,
    user.role,
  ]);

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
            <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-label="Open navigation"
                  className="rounded-md border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sea md:hidden"
                  onClick={() => setIsMobileSidebarOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Workspace</p>
                  <h1 className="truncate font-[family-name:var(--font-heading)] text-lg font-semibold text-ink">
                    {pageTitle}
                  </h1>
                  {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-3">
                {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
                <div className="text-right">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{roleLabel(user.role)}</p>
                </div>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1" aria-busy={ariaBusy || undefined}>
            <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
