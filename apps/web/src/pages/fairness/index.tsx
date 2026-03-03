import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ApiError, FairnessReportResponse, UserRole, getFairnessReport } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/skeleton/PageSkeleton';
import { Skeleton } from '@/components/skeleton/Skeleton';
import { TableSkeleton } from '@/components/skeleton/TableSkeleton';
import { EmptyState } from '@/components/state/EmptyState';
import { ErrorState } from '@/components/state/ErrorState';

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
    return <PageSkeleton withLayout showToolbar content={<TableSkeleton rows={6} columns={7} />} />;
  }

  return (
    <AppLayout
      user={user}
      title="Fairness Analytics"
      subtitle="Review workload distribution, desired-hours balance, and premium shift equity."
      ariaBusy={loadingState}
    >
      <div className="space-y-4">
        <section className="panel p-5">
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
          <div className="mt-3 text-xs text-slate-600">
            {report ? report.premiumDefinition : <Skeleton className="inline-block h-3 w-72" rounded="full" />}
          </div>
        </section>

        <section className="panel p-5">
          {error ? <ErrorState message={error} onRetry={() => void loadReport()} /> : null}
          {loadingState && !report && !error ? (
            <TableSkeleton rows={6} columns={7} className="border-none shadow-none" />
          ) : null}
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

          {report ? (
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
                  {report.staff.map((row) => (
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
          ) : null}

          {report && report.staff.length === 0 && !loadingState ? (
            <EmptyState
              className="mt-4"
              title="No Staff Data"
              description="No certified staff were found for this location and date range."
            />
          ) : null}
          {!report && !loadingState && !error ? (
            <EmptyState
              title="Select a Location"
              description="Choose a location and date range to view fairness analytics."
            />
          ) : null}
        </section>
      </div>
    </AppLayout>
  );
}
