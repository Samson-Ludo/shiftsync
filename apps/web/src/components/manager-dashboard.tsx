'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { CurrentUser, ShiftItem } from '@/lib/types';
import { NotificationCenter } from './notification-center';

const mondayIso = () => DateTime.now().startOf('week').toISODate() ?? DateTime.now().toISODate()!;

type CreateFormState = {
  title: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
};

const initialCreateForm: CreateFormState = {
  title: 'New Shift',
  localDate: DateTime.now().toISODate() ?? '',
  startLocalTime: '09:00',
  endLocalTime: '17:00',
};

export function ManagerDashboard({ user }: { user: CurrentUser }) {
  const locations = useMemo(() => user.managerLocations ?? [], [user.managerLocations]);
  const [locationId, setLocationId] = useState(locations[0]?._id ?? '');
  const [weekStart, setWeekStart] = useState(mondayIso());
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(initialCreateForm);

  const selectedLocation = useMemo(
    () => locations.find((location) => location._id === locationId),
    [locations, locationId],
  );

  const loadShifts = useCallback(async () => {
    if (!locationId) {
      return;
    }

    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ locationId, weekStart }).toString();
    const response = await fetch(`/api/shifts?${query}`, { cache: 'no-store' });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? 'Failed to load shifts');
      setLoading(false);
      return;
    }

    const payload = (await response.json()) as { shifts: ShiftItem[] };
    setShifts(payload.shifts ?? []);
    setLoading(false);
  }, [locationId, weekStart]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const createShift = async () => {
    const response = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        title: createForm.title,
        localDate: createForm.localDate,
        startLocalTime: createForm.startLocalTime,
        endLocalTime: createForm.endLocalTime,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? 'Failed to create shift');
      return;
    }

    setShowCreateModal(false);
    setCreateForm(initialCreateForm);
    await loadShifts();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="panel flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Manager Dashboard</p>
          <h1 className="font-[var(--font-heading)] text-2xl font-semibold">ShiftSync</h1>
          <p className="text-sm text-slate-600">
            {user.firstName} {user.lastName} ({user.role})
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs text-slate-500">Location</span>
            <select
              className="input"
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
          <label>
            <span className="mb-1 block text-xs text-slate-500">Week Start</span>
            <input
              className="input"
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
            />
          </label>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <article className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-[var(--font-heading)] text-lg font-semibold">
              Shifts {selectedLocation ? `- ${selectedLocation.code}` : ''}
            </h2>
            <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
              Create Shift
            </button>
          </div>
          {loading ? <p className="text-sm text-slate-500">Loading shifts...</p> : null}
          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
          <ul className="space-y-3">
            {shifts.map((shift) => (
              <li key={shift._id} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{shift.title}</h3>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      shift.published ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {shift.published ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {shift.localDate} {shift.startLocalTime}-{shift.endLocalTime} ({shift.timezone})
                </p>
                <p className="mt-1 text-xs text-slate-500">Assignments: {shift.assignments?.length ?? 0}</p>
              </li>
            ))}
            {!loading && shifts.length === 0 ? (
              <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                No shifts found for the selected week.
              </li>
            ) : null}
          </ul>
        </article>

        <aside className="space-y-4">
          <section className="panel p-5">
            <h2 className="font-[var(--font-heading)] text-lg font-semibold">Shift Details</h2>
            <p className="mt-2 text-sm text-slate-600">
              Placeholder panel for selected shift details, assignment controls, and swap impact.
            </p>
          </section>
          <NotificationCenter />
        </aside>
      </section>

      {showCreateModal ? (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="panel w-full max-w-md p-5">
            <h2 className="font-[var(--font-heading)] text-lg font-semibold">Create Shift</h2>
            <div className="mt-4 space-y-3">
              <input
                className="input"
                placeholder="Shift title"
                value={createForm.title}
                onChange={(event) => setCreateForm((curr) => ({ ...curr, title: event.target.value }))}
              />
              <input
                className="input"
                type="date"
                value={createForm.localDate}
                onChange={(event) =>
                  setCreateForm((curr) => ({ ...curr, localDate: event.target.value }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input"
                  type="time"
                  value={createForm.startLocalTime}
                  onChange={(event) =>
                    setCreateForm((curr) => ({ ...curr, startLocalTime: event.target.value }))
                  }
                />
                <input
                  className="input"
                  type="time"
                  value={createForm.endLocalTime}
                  onChange={(event) =>
                    setCreateForm((curr) => ({ ...curr, endLocalTime: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-slate-300 px-4 py-2 text-sm" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void createShift()}>
                Save Shift
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
