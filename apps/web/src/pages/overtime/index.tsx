import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ApiError, OvertimeReportResponse, UserRole, getOvertimeReport } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';

const managerRoles: UserRole[] = ['admin', 'manager'];
const mondayIso = () => DateTime.now().startOf('week').toISODate() ?? DateTime.now().toISODate()!;

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.message || 'Failed to load overtime report';
  }

  return 'Failed to load overtime report';
};

export default function OvertimePage() {
  const { user, loading } = useRequireAuth({ allowedRoles: managerRoles });
  const locations = useMemo(() => user?.managerLocations ?? [], [user]);

  const [locationId, setLocationId] = useState('');
  const [weekStart, setWeekStart] = useState(mondayIso());
  const [report, setReport] = useState<OvertimeReportResponse | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(locations[0]._id);
    }
  }, [locationId, locations]);

  const loadReport = useCallback(async () => {
    if (!locationId) {
      return;
    }

    setLoadingState(true);
    setError(null);

    try {
      const payload = await getOvertimeReport(locationId, weekStart);
      setReport(payload);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoadingState(false);
    }
  }, [locationId, weekStart]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading overtime dashboard...</p>
        </section>
      </main>
    );
  }

  return (
    <AppLayout user={user}>
      <div className="space-y-4">
      <header className="panel flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Overtime Dashboard</p>
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-ink">
            Weekly Overtime Projection
          </h1>
          {report ? (
            <p className="text-xs text-slate-600">Formula: {report.overtimePremiumFormula}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <label>
            <span className="mr-2 text-xs text-slate-500">Week Start</span>
            <input
              className="input"
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
            />
          </label>
        </div>
      </header>

      <section className="panel p-5">
        {loadingState ? <p className="text-sm text-slate-500">Loading overtime report...</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {report ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              Staff over 40h: <span className="font-semibold">{report.totals.staffOver40Count}</span>
            </p>
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              Projected premium cost:{' '}
              <span className="font-semibold">{formatCurrency(report.totals.projectedOvertimePremiumCost)}</span>
            </p>
          </div>
        ) : null}

        <ul className="space-y-3">
          {report?.staff.map((row) => (
            <li
              key={row.staffId}
              className={`rounded-md border p-3 ${
                row.overtimeHours > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{row.staffName}</p>
                <p className="text-xs text-slate-600">Hourly Rate: {formatCurrency(row.hourlyRate)}</p>
              </div>
              <div className="mt-1 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
                <p>Total Hours: {row.totalHours}</p>
                <p>Overtime Hours: {row.overtimeHours}</p>
                <p>Overtime Premium: {formatCurrency(row.overtimePremiumCost)}</p>
              </div>
              {row.overtimeDrivers.length > 0 ? (
                <div className="mt-2 rounded-md border border-amber-300 bg-white p-2">
                  <p className="text-xs font-semibold text-amber-800">Assignments that pushed overtime</p>
                  <ul className="mt-1 space-y-1 text-xs text-slate-700">
                    {row.overtimeDrivers.map((driver) => (
                      <li key={driver.assignmentId}>
                        {driver.shiftTitle} ({driver.localDate} {driver.startLocalTime}-{driver.endLocalTime}) | +
                        {driver.overtimeHoursFromAssignment} overtime hours
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
          {report && report.staff.length === 0 && !loadingState ? (
            <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              No assignments found for this location/week.
            </li>
          ) : null}
        </ul>
      </section>
      </div>
    </AppLayout>
  );
}
