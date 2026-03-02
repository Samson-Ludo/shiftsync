'use client';

import { useEffect, useMemo, useState } from 'react';
import { NotificationItem } from '@/lib/types';
import { getSocket } from '@/lib/socket';

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [socketReady, setSocketReady] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  const fetchNotifications = async () => {
    const response = await fetch('/api/notifications', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { notifications: NotificationItem[] };
    setNotifications(payload.notifications ?? []);
  };

  const markRead = async (notificationId: string) => {
    const response = await fetch(`/api/notifications/${notificationId}/read`, {
      method: 'PATCH',
    });

    if (!response.ok) {
      return;
    }

    setNotifications((current) =>
      current.map((item) =>
        item._id === notificationId
          ? {
              ...item,
              read: true,
            }
          : item,
      ),
    );
  };

  useEffect(() => {
    void fetchNotifications();

    const socket = getSocket(null, process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000');
    socket.on('socket:ready', () => setSocketReady(true));
    socket.on('notification:new', () => {
      void fetchNotifications();
    });

    return () => {
      socket.off('socket:ready');
      socket.off('notification:new');
    };
  }, []);

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-[var(--font-heading)] text-lg font-semibold">Notifications</h2>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {unreadCount} unread
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Socket status: {socketReady ? 'connected' : 'connecting'}
      </p>
      <ul className="mt-3 space-y-2">
        {notifications.map((notification) => (
          <li key={notification._id} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{notification.title}</p>
              {!notification.read ? (
                <button
                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                  onClick={() => void markRead(notification._id)}
                >
                  Mark read
                </button>
              ) : (
                <span className="text-xs text-slate-500">Read</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">{notification.body}</p>
          </li>
        ))}
        {notifications.length === 0 ? (
          <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No notifications yet.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
