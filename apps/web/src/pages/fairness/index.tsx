import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ApiError, FairnessReportResponse, UserRole, getFairnessReport } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';

const managerRoles: UserRole[] = ['admin', 'manager'];

const mondayIso = () => DateTime.now().startOf('week').toISODate() ?? DateTime.now().toISODate()!;
const sundayIso = () =>
  DateTime.now().startOf('week').plus({ days: 6 }).toISODate() ?? DateTime.now().toISODate()!;

const scoreTone = (score: number): string => {
  if (score >= 85) {
    return 'text-green-700';
  }
  if (score >= 70) {
    return 'text-amber-700';
  }
  return 'text-red-700';
};

const balanceTone = (balance: string): string => {
  if (balance === 'over_scheduled') {
    return 'text-amber-700';
  }
  if (balance === 'under_scheduled') {
    return 'text-red-700';
  }
  return 'text-green-700';
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.message) {
    return error.message;
  }
  return 'Failed to load fairness analytics';
};

export default function FairnessPage() {
  const { user, loading } = useRequireAuth({ allowedRoles: managerRoles });
  const locations = useMemo(() => user?.managerLocations ?? [], [user]);

  const [locationId, setLocationId] = useState('');
  const [startDate, setStartDate] = useState(mondayIso());
  const [endDate, setEndDate] = useState(sundayIso());
  const [report, setReport] = useState<FairnessReportResponse | null>(null);
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
      const payload = await getFairnessReport({ locationId, startDate, endDate });
      setReport(payload);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoadingState(false);
    }
  }, [locationId, startDate, endDate]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading fairness analytics...</p>
        </section>
      </main>
    );
  }

  return (
    <AppLayout user={user}>
      <div className="space-y-4">
      <header className="panel flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Analytics</p>
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-ink">
            Fairness Distribution
          </h1>
          {report ? <p className="text-xs text-slate-600">{report.premiumDefinition}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label>
            <span className="mr-2 text-xs text-slate-500">Location</span>
            <select className="input min-w-48" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location._id} value={location._id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mr-2 text-xs text-slate-500">Start</span>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            <span className="mr-2 text-xs text-slate-500">End</span>
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
      </header>

      <section className="panel p-5">
        {loadingState ? <p className="text-sm text-slate-500">Loading fairness report...</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {report ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              Overall Fairness Score:{' '}
              <span className={`font-semibold ${scoreTone(report.overall.overallFairnessScore)}`}>
                {report.overall.overallFairnessScore}
              </span>
            </p>
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              Premium Target / Staff: <span className="font-semibold">{report.overall.premiumTargetPerStaff}</span>
            </p>
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              Total Assigned Hours: <span className="font-semibold">{report.overall.totalAssignedHours}</span>
            </p>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Staff</th>
                <th className="px-2 py-2">Assigned</th>
                <th className="px-2 py-2">Desired</th>
                <th className="px-2 py-2">Delta</th>
                <th className="px-2 py-2">Premium</th>
                <th className="px-2 py-2">Fairness</th>
                <th className="px-2 py-2">Indicator</th>
              </tr>
            </thead>
            <tbody>
              {report?.staff.map((row) => (
                <tr key={row.staffId} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium">{row.staffName}</td>
                  <td className="px-2 py-2">{row.assignedHours}</td>
                  <td className="px-2 py-2">{row.desiredHoursForPeriod}</td>
                  <td className="px-2 py-2">{row.deltaHours}</td>
                  <td className="px-2 py-2">{row.premiumShiftCount}</td>
                  <td className={`px-2 py-2 font-semibold ${scoreTone(row.fairnessScore)}`}>{row.fairnessScore}</td>
                  <td className={`px-2 py-2 ${balanceTone(row.scheduleBalance)}`}>{row.scheduleBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {report && report.staff.length === 0 && !loadingState ? (
          <p className="mt-4 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No certified staff found for this location.
          </p>
        ) : null}
      </section>
      </div>
    </AppLayout>
  );
}
