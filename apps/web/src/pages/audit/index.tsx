import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  ApiError,
  AuditExportResponse,
  UserRole,
  downloadAuditExportCsv,
  getAuditExport,
} from '@/lib/api';
import { useRequireAuth } from '@/lib/auth/useRequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';

const adminRoles: UserRole[] = ['admin'];
const defaultStartDate = () => DateTime.now().minus({ days: 7 }).toISODate() ?? DateTime.now().toISODate()!;
const defaultEndDate = () => DateTime.now().toISODate() ?? DateTime.now().toISODate()!;

const toUtcRange = (startDate: string, endDate: string) => ({
  start: DateTime.fromISO(startDate, { zone: 'utc' }).startOf('day').toISO() ?? '',
  end: DateTime.fromISO(endDate, { zone: 'utc' }).endOf('day').toISO() ?? '',
});

const toErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.message) {
    return error.message;
  }

  return 'Failed to load audit export';
};

export default function AuditLogsPage() {
  const { user, loading } = useRequireAuth({ allowedRoles: adminRoles });
  const locations = useMemo(() => user?.managerLocations ?? [], [user]);

  const [locationId, setLocationId] = useState('');
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState(defaultEndDate());
  const [report, setReport] = useState<AuditExportResponse | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(locations[0]._id);
    }
  }, [locationId, locations]);

  const loadAudit = useCallback(async () => {
    const range = toUtcRange(startDate, endDate);
    if (!range.start || !range.end) {
      setError('Choose a valid date range.');
      setReport(null);
      return;
    }

    setLoadingState(true);
    setError(null);

    try {
      const payload = await getAuditExport({
        start: range.start,
        end: range.end,
        ...(locationId ? { locationId } : {}),
      });

      setReport(payload);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
      setReport(null);
    } finally {
      setLoadingState(false);
    }
  }, [endDate, locationId, startDate]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const downloadCsv = async () => {
    const range = toUtcRange(startDate, endDate);
    if (!range.start || !range.end) {
      setError('Choose a valid date range.');
      return;
    }

    setDownloading(true);

    try {
      const csvBlob = await downloadAuditExportCsv({
        start: range.start,
        end: range.end,
        ...(locationId ? { locationId } : {}),
      });

      const url = window.URL.createObjectURL(csvBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-export-${startDate}-to-${endDate}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(toErrorMessage(downloadError));
    } finally {
      setDownloading(false);
    }
  };

  if (loading || !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <section className="panel w-full p-8 text-center">
          <p className="text-sm text-slate-600">Loading audit logs...</p>
        </section>
      </main>
    );
  }

  return (
    <AppLayout user={user}>
      <div className="space-y-4">
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Admin Export</p>
              <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold text-ink">Audit Logs</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                onClick={() => void loadAudit()}
                disabled={loadingState}
              >
                {loadingState ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void downloadCsv()}
                disabled={downloading}
              >
                {downloading ? 'Downloading...' : 'Download CSV'}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label>
              <span className="mb-1 block text-xs text-slate-500">Location</span>
              <select className="input" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">All locations</option>
                {locations.map((location) => (
                  <option key={location._id} value={location._id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-500">Start date</span>
              <input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-500">End date</span>
              <input className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          {report ? (
            <p className="mt-3 text-xs text-slate-600">
              Showing <span className="font-semibold">{report.count}</span> records from {startDate} to {endDate}.
            </p>
          ) : null}
        </section>

        <section className="panel overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {report?.logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">{log.actorName ?? log.actorId}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">{log.action}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {log.entityType} ({log.entityId})
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <details>
                        <summary className="cursor-pointer text-slate-700">View snapshots</summary>
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px]">
                          before: {JSON.stringify(log.beforeSnapshot)}
                          {'\n'}after: {JSON.stringify(log.afterSnapshot)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loadingState && report && report.logs.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No audit logs found for this range.</p>
          ) : null}
        </section>
      </div>
    </AppLayout>
  );
}
