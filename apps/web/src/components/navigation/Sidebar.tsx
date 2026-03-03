import Link from 'next/link';
import { useRouter } from 'next/router';
import { LogOut, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { CurrentUser } from '@/lib/api';
import { getNavItems, isNavItemActive } from './nav-config';

type SidebarProps = {
  user: CurrentUser;
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
};

const focusableSelectors = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const roleLabel = (role: CurrentUser['role']): string => role.charAt(0).toUpperCase() + role.slice(1);

export function Sidebar({ user, isOpen, onClose, onLogout }: SidebarProps) {
  const router = useRouter();
  const mobileSidebarRef = useRef<HTMLElement | null>(null);
  const navItems = useMemo(() => getNavItems(user.role), [user.role]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousActiveElement = document.activeElement as HTMLElement | null;
    const sidebar = mobileSidebarRef.current;

    const getFocusable = () => {
      if (!sidebar) {
        return [] as HTMLElement[];
      }

      return Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
        (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
      );
    };

    const focusable = getFocusable();
    focusable[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const targets = getFocusable();
      if (targets.length === 0) {
        event.preventDefault();
        return;
      }

      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [isOpen, onClose]);

  const navLinks = (
    <nav aria-label="Primary navigation" className="mt-5 flex-1 space-y-1 overflow-y-auto pr-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isNavItemActive(item, router.pathname, router.asPath, user.role);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sea focus:ring-offset-1 ${
              active
                ? 'bg-sea text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
            onClick={onClose}
          >
            <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-slate-500 group-hover:text-slate-700'}`} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const sidebarBody = (mobile: boolean) => (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">ShiftSync</p>
          <p className="mt-1 font-[family-name:var(--font-heading)] text-lg font-semibold text-ink">Operations</p>
          <p className="mt-1 text-xs text-slate-500">{roleLabel(user.role)} Workspace</p>
        </div>
        {mobile ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sea"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {navLinks}

      <div className="mt-4 border-t border-slate-200 pt-4">
        <p className="truncate text-sm font-medium text-slate-800">
          {user.firstName} {user.lastName}
        </p>
        <p className="text-xs text-slate-500">{user.email}</p>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sea"
        >
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden md:block md:w-72 md:flex-none">
        <aside className="sticky top-0 h-screen border-r border-slate-200 bg-white/90 shadow-sm backdrop-blur">
          {sidebarBody(false)}
        </aside>
      </div>

      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-900/45 transition-opacity duration-300 md:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        ref={mobileSidebarRef}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation menu"
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-200 bg-white shadow-xl transition-transform duration-300 md:hidden ${
          isOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        {sidebarBody(true)}
      </aside>
    </>
  );
}
