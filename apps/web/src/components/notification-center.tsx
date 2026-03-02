import { useCallback, useEffect, useMemo, useState } from 'react';
import { NotificationItem, listNotifications, markNotificationRead } from '@/lib/api';
import { getToken } from '@/lib/api/auth';
import { getSocket } from '@/lib/socket';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [socketReady, setSocketReady] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  const fetchNotifications = useCallback(async () => {
    try {
      const payload = await listNotifications();
      setNotifications(payload.notifications ?? []);
    } catch {
      // Notification panel should fail silently for dashboard continuity.
    }
  }, []);

  const markRead = async (notificationId: string) => {
    try {
      await markNotificationRead(notificationId);
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
    } catch {
      // Keep current state if mark-read fails.
    }
  };

  useEffect(() => {
    void fetchNotifications();

    const token = getToken();
    if (!token) {
      return;
    }

    const socket = getSocket(token, apiBaseUrl);
    socket.on('socket:ready', () => setSocketReady(true));
    socket.on('notification:new', () => {
      void fetchNotifications();
    });

    return () => {
      socket.off('socket:ready');
      socket.off('notification:new');
    };
  }, [fetchNotifications]);

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">Notifications</h2>
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
