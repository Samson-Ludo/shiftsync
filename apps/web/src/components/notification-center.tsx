import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  NotificationItem,
  NotificationPreference,
  listNotifications,
  markNotificationsRead,
  updateNotificationPreference,
} from '@/lib/api';
import { getToken } from '@/lib/api/auth';
import { getSocket } from '@/lib/socket';

type NotificationCenterProps = {
  mode?: 'compact' | 'full';
  initialPreference?: NotificationPreference;
  onPreferenceChange?: (preference: NotificationPreference) => void;
};

const readEmailSimulated = (metadata: Record<string, unknown> | undefined): boolean | null => {
  if (!metadata || typeof metadata.emailSimulated !== 'boolean') {
    return null;
  }

  return metadata.emailSimulated;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export function NotificationCenter({
  mode = 'compact',
  initialPreference,
  onPreferenceChange,
}: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [socketReady, setSocketReady] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(mode === 'full' ? 20 : 6);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [preference, setPreference] = useState<NotificationPreference>(
    initialPreference ?? 'in_app_only',
  );
  const [savingPreference, setSavingPreference] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await listNotifications(page, pageSize);
      setNotifications(payload.notifications ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      // Notification panel should fail silently for dashboard continuity.
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  const markRead = async (notificationId: string) => {
    try {
      await markNotificationsRead([notificationId]);
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

  const handlePreferenceChange = async (nextPreference: NotificationPreference) => {
    setSavingPreference(true);
    try {
      const payload = await updateNotificationPreference(nextPreference);
      setPreference(payload.preference);
      onPreferenceChange?.(payload.preference);
    } catch {
      // keep current preference on failure
    } finally {
      setSavingPreference(false);
    }
  };

  useEffect(() => {
    if (initialPreference) {
      setPreference(initialPreference);
    }
  }, [initialPreference]);

  useEffect(() => {
    void fetchNotifications();

    const token = getToken();
    if (!token) {
      return;
    }

    const socket = getSocket(token, apiBaseUrl);
    socket.on('socket:ready', () => setSocketReady(true));
    socket.on('notification_created', () => {
      void fetchNotifications();
    });

    return () => {
      socket.off('socket:ready');
      socket.off('notification_created');
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

      {mode === 'full' ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Notification preference</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={`rounded border px-3 py-1 text-xs ${
                preference === 'in_app_only'
                  ? 'border-sea bg-cyan-50 text-cyan-700'
                  : 'border-slate-300 bg-white text-slate-600'
              }`}
              disabled={savingPreference}
              onClick={() => void handlePreferenceChange('in_app_only')}
            >
              In-app only
            </button>
            <button
              className={`rounded border px-3 py-1 text-xs ${
                preference === 'in_app_plus_email_sim'
                  ? 'border-sea bg-cyan-50 text-cyan-700'
                  : 'border-slate-300 bg-white text-slate-600'
              }`}
              disabled={savingPreference}
              onClick={() => void handlePreferenceChange('in_app_plus_email_sim')}
            >
              In-app + email simulation
            </button>
          </div>
        </div>
      ) : null}

      <ul className="mt-3 space-y-2">
        {loading ? <li className="text-sm text-slate-500">Loading notifications...</li> : null}
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
            {readEmailSimulated(notification.metadata) !== null ? (
              <p className="mt-1 text-xs text-slate-500">
                {readEmailSimulated(notification.metadata)
                  ? 'Email simulation attached'
                  : 'In-app delivery only'}
              </p>
            ) : null}
          </li>
        ))}
        {!loading && notifications.length === 0 ? (
          <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No notifications yet.
          </li>
        ) : null}
      </ul>

      {mode === 'full' ? (
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>
            Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
              disabled={!hasPrev}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Prev
            </button>
            <button
              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
              disabled={!hasNext}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
