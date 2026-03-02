import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { CurrentUser, OnDutyEntry, UserRole, getOnDuty } from '@/lib/api';
import { getToken } from '@/lib/api/auth';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { getSocket } from '@/lib/socket';

const allowedRoles: UserRole[] = ['admin', 'manager'];

type OnDutyUpdatedPayload = {
  locationId?: string;
  onDuty?: OnDutyEntry[];
};

const formatUtc = (iso: string): string => DateTime.fromISO(iso, { zone: 'utc' }).toFormat('ccc HH:mm');

const locationOptions = (user: CurrentUser) => user.managerLocations ?? [];

export default function OnDutyPage() {
  const { user, loading } = useRequireAuth({ allowedRoles });
  const locations = useMemo(() => (user ? locationOptions(user) : []), [user]);
  const [locationId, setLocationId] = useState('');
  const [onDuty, setOnDuty] = useState<OnDutyEntry[]>([]);
  const [loadingState, setLoadingState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(locations[0]._id);
    }
  }, [locationId, locations]);

  const loadOnDuty = useCallback(async () => {
    if (!locationId) {
      return;
    }

    setLoadingState(true);
    setError(null);
    try {
      const payload = await getOnDuty(locationId);
      setOnDuty(payload.onDuty ?? []);
    } catch {
      setError('Failed to load on-duty state');
    } finally {
      setLoadingState(false);
    }
  }, [locationId]);

  useEffect(() => {
    void loadOnDuty();
  }, [loadOnDuty]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      return;
    }

    const socket = getSocket(token, process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000');

    const handleOnDutyUpdated = (payload: OnDutyUpdatedPayload) => {
      if (!payload.locationId || payload.locationId !== locationId) {
        return;
      }

      if (Array.isArray(payload.onDuty)) {
        setOnDuty(payload.onDuty);
      } else {
        void loadOnDuty();
      }
    };

    socket.on('on_duty_updated', handleOnDutyUpdated);

    return () => {
      socket.off('on_duty_updated', handleOnDutyUpdated);
    };
  }, [locationId, loadOnDuty]);

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading on-duty dashboard...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <header className="panel flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">On-Duty Dashboard</p>
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-ink">
            Live Clocked-In Staff
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <label>
            <span className="mr-2 text-xs text-slate-500">Location</span>
            <select
              className="input min-w-48"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location._id} value={location._id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <Link href="/manager" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            Back to Manager
          </Link>
        </div>
      </header>

      <section className="panel p-5">
        {loadingState ? <p className="text-sm text-slate-500">Loading on-duty staff...</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {!loadingState && onDuty.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No staff currently clocked in for this location.
          </p>
        ) : null}

        <ul className="space-y-3">
          {onDuty.map((entry) => (
            <li key={`${entry.shiftId}:${entry.staffId}`} className="rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{entry.staffName}</p>
                <p className="text-xs text-slate-500">Clocked in: {formatUtc(entry.clockedInAtUtc)} UTC</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {entry.shiftTitle} - {entry.localDate} {entry.startLocalTime}-{entry.endLocalTime} ({entry.timezone})
              </p>
              <p className="text-xs text-slate-500">{entry.staffEmail}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
