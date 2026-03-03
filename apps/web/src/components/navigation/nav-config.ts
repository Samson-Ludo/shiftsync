import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Clock3,
  Download,
  FileText,
  Inbox,
  LayoutDashboard,
  Repeat,
  type LucideIcon,
} from 'lucide-react';
import { UserRole } from '@/lib/api';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const adminItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Manager View', href: '/manager', icon: Building2 },
  { label: 'Fairness Analytics', href: '/fairness', icon: BarChart3 },
  { label: 'Overtime Reports', href: '/overtime', icon: Clock3 },
  { label: 'Audit Logs', href: '/audit', icon: FileText },
  { label: 'Notifications', href: '/notifications', icon: Bell },
];

const managerItems: NavItem[] = [
  { label: 'Dashboard', href: '/manager', icon: LayoutDashboard },
  { label: 'On-Duty', href: '/on-duty', icon: Activity },
  { label: 'Overtime Reports', href: '/overtime', icon: Clock3 },
  { label: 'Fairness Analytics', href: '/fairness', icon: BarChart3 },
  { label: 'Swap Requests', href: '/manager#swap-inbox', icon: Inbox },
  { label: 'Notifications', href: '/notifications', icon: Bell },
];

const staffItems: NavItem[] = [
  { label: 'My Shifts', href: '/staff', icon: CalendarDays },
  { label: 'Available Drops', href: '/staff#available-drops', icon: Download },
  { label: 'Swap Requests', href: '/staff#swap-requests', icon: Repeat },
  { label: 'Notifications', href: '/notifications', icon: Bell },
];

export const getNavItems = (role: UserRole): NavItem[] => {
  if (role === 'admin') {
    return adminItems;
  }

  if (role === 'manager') {
    return managerItems;
  }

  return staffItems;
};

const parseHref = (href: string): { pathname: string; hash: string | null } => {
  const [pathname, hash] = href.split('#');
  return {
    pathname,
    hash: hash || null,
  };
};

const currentHashFromAsPath = (asPath: string): string | null => {
  const hashIndex = asPath.indexOf('#');
  if (hashIndex === -1) {
    return null;
  }

  const hash = asPath.slice(hashIndex + 1).trim();
  return hash.length > 0 ? hash : null;
};

export const isNavItemActive = (
  item: NavItem,
  pathname: string,
  asPath: string,
  role: UserRole,
): boolean => {
  const items = getNavItems(role);
  const currentHash = currentHashFromAsPath(asPath);
  const target = parseHref(item.href);

  if (target.pathname !== pathname) {
    return false;
  }

  if (target.hash) {
    return target.hash === currentHash;
  }

  if (!currentHash) {
    return true;
  }

  return !items.some((entry) => {
    const parsed = parseHref(entry.href);
    return parsed.pathname === pathname && parsed.hash === currentHash;
  });
};

const fallbackTitleByPath: Record<string, string> = {
  '/manager': 'Manager View',
  '/staff': 'My Shifts',
  '/notifications': 'Notifications',
  '/overtime': 'Overtime Reports',
  '/fairness': 'Fairness Analytics',
  '/on-duty': 'On-Duty',
  '/dashboard': 'Dashboard',
  '/audit': 'Audit Logs',
};

export const getPageTitle = (role: UserRole, pathname: string, asPath: string): string => {
  const active = getNavItems(role).find((item) => isNavItemActive(item, pathname, asPath, role));
  if (active) {
    return active.label;
  }

  return fallbackTitleByPath[pathname] ?? 'ShiftSync';
};
