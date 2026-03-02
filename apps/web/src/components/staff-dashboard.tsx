import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ApiError, CurrentUser, ShiftAssignment, ShiftItem, listShifts } from '@/lib/api';
import { NotificationCenter } from './notification-center';

const mondayIso = () => DateTime.now().startOf('week').toISODate() ?? DateTime.now().toISODate()!;

const assignmentMatchesUser = (assignment: ShiftAssignment, userId: string): boolean => {
  if (typeof assignment.staffId === 'string') {
    return assignment.staffId === userId;
  }
  return assignment.staffId._id === userId;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError && error.message) {
    return error.message;
  }

  return fallback;
};

export function StaffDashboard({ user }: { user: CurrentUser }) {
  const [weekStart, setWeekStart] = useState(mondayIso());
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const payload = await listShifts(undefined, weekStart);
      setShifts(payload.shifts ?? []);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to load shifts'));
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const myShifts = useMemo(
    () =>
      shifts.filter((shift) =>
        shift.assignments?.some((assignment) => assignmentMatchesUser(assignment, user.id)),
      ),
    [shifts, user.id],
  );

  const publishedByLocation = useMemo(() => {
    const grouped = new Map<string, ShiftItem[]>();

    shifts
      .filter((shift) => shift.published)
      .forEach((shift) => {
        const locationName = typeof shift.locationId === 'string' ? 'Unknown Location' : shift.locationId.name;
        grouped.set(locationName, [...(grouped.get(locationName) ?? []), shift]);
      });

    return Array.from(grouped.entries());
  }, [shifts]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="panel flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Staff Dashboard</p>
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold">
            Welcome, {user.firstName} {user.lastName}
          </h1>
        </div>
        <label>
          <span className="mb-1 block text-xs text-slate-500">Week Start</span>
          <input
            className="input"
            type="date"
            value={weekStart}
            onChange={(event) => setWeekStart(event.target.value)}
          />
        </label>
      </header>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <article className="panel p-5">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">My Shifts</h2>
            {loading ? <p className="mt-3 text-sm text-slate-500">Loading shifts...</p> : null}
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            <ul className="mt-3 space-y-3">
              {myShifts.map((shift) => (
                <li key={shift._id} className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium">{shift.title}</p>
                  <p className="text-sm text-slate-600">
                    {shift.localDate} {shift.startLocalTime}-{shift.endLocalTime} ({shift.timezone})
                  </p>
                </li>
              ))}
              {!loading && myShifts.length === 0 ? (
                <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  You have no assigned shifts this week.
                </li>
              ) : null}
            </ul>
          </article>

          <article className="panel p-5">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">Published Schedule</h2>
            <div className="mt-3 space-y-4">
              {publishedByLocation.map(([locationName, locationShifts]) => (
                <div key={locationName}>
                  <h3 className="text-sm font-semibold text-slate-700">{locationName}</h3>
                  <ul className="mt-2 space-y-2">
                    {locationShifts.map((shift) => (
                      <li key={shift._id} className="rounded-md border border-slate-200 p-3 text-sm">
                        {shift.title}: {shift.localDate} {shift.startLocalTime}-{shift.endLocalTime}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!loading && publishedByLocation.length === 0 ? (
                <p className="text-sm text-slate-500">No published shifts visible for this week.</p>
              ) : null}
            </div>
          </article>
        </div>

        <aside>
          <NotificationCenter />
        </aside>
      </section>
    </main>
  );
}
