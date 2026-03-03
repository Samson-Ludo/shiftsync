import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  ApiError,
  AssignmentSuggestion,
  CurrentUser,
  ShiftAssignment,
  ShiftItem,
  SwapRequestItem,
  acceptSwapRequest,
  cancelSwapRequest,
  claimDropRequest,
  createSwapRequest,
  listEligibleSwapStaff,
  listShifts,
  listSwapRequests,
} from '@/lib/api';
import { getToken } from '@/lib/api/auth';
import { getSocket } from '@/lib/socket';
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
    const details = error.data as
      | {
          details?: {
            violations?: Array<{ message?: string }>;
          };
        }
      | undefined;

    const violationMessages = details?.details?.violations
      ?.map((entry) => entry.message)
      .filter((message): message is string => Boolean(message));

    if (violationMessages && violationMessages.length > 0) {
      return `${error.message} ${violationMessages.join(' ')}`;
    }

    return error.message;
  }

  return fallback;
};

const statusTone = (status: SwapRequestItem['status']): string => {
  if (status === 'approved') {
    return 'bg-green-100 text-green-700';
  }

  if (status === 'rejected' || status === 'cancelled' || status === 'expired') {
    return 'bg-red-100 text-red-700';
  }

  if (status === 'claimed' || status === 'accepted') {
    return 'bg-blue-100 text-blue-700';
  }

  return 'bg-amber-100 text-amber-700';
};

export function StaffDashboard({ user }: { user: CurrentUser }) {
  const [weekStart, setWeekStart] = useState(mondayIso());
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [myRequests, setMyRequests] = useState<SwapRequestItem[]>([]);
  const [availableDrops, setAvailableDrops] = useState<SwapRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapMessage, setSwapMessage] = useState<string | null>(null);
  const [actionRequestId, setActionRequestId] = useState<string | null>(null);
  const [dropShiftId, setDropShiftId] = useState<string | null>(null);

  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapTargetShift, setSwapTargetShift] = useState<ShiftItem | null>(null);
  const [swapSuggestions, setSwapSuggestions] = useState<AssignmentSuggestion[]>([]);
  const [swapSuggestionsLoading, setSwapSuggestionsLoading] = useState(false);
  const [selectedSwapStaffId, setSelectedSwapStaffId] = useState('');
  const [swapNote, setSwapNote] = useState('');
  const [creatingSwap, setCreatingSwap] = useState(false);

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

  const loadSwapData = useCallback(async () => {
    setSwapLoading(true);
    setSwapError(null);

    try {
      const [mine, available] = await Promise.all([
        listSwapRequests({ mine: true }),
        listSwapRequests({ available: true }),
      ]);

      setMyRequests(mine.swapRequests ?? []);
      setAvailableDrops(available.swapRequests ?? []);
    } catch (loadError) {
      setSwapError(getErrorMessage(loadError, 'Failed to load swap requests'));
    } finally {
      setSwapLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  useEffect(() => {
    void loadSwapData();
  }, [loadSwapData]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      return;
    }

    const socket = getSocket(token, process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000');
    const reloadAll = () => {
      void loadShifts();
      void loadSwapData();
    };

    socket.on('schedule_published', reloadAll);
    socket.on('schedule_updated', reloadAll);
    socket.on('shift_updated', reloadAll);
    socket.on('assignment_created', reloadAll);
    socket.on('assignment_removed', reloadAll);
    socket.on('swap_requested', reloadAll);
    socket.on('swap_updated', reloadAll);
    socket.on('swap_cancelled', reloadAll);

    return () => {
      socket.off('schedule_published', reloadAll);
      socket.off('schedule_updated', reloadAll);
      socket.off('shift_updated', reloadAll);
      socket.off('assignment_created', reloadAll);
      socket.off('assignment_removed', reloadAll);
      socket.off('swap_requested', reloadAll);
      socket.off('swap_updated', reloadAll);
      socket.off('swap_cancelled', reloadAll);
    };
  }, [loadShifts, loadSwapData]);

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

  const openSwapModal = async (shift: ShiftItem) => {
    setSwapModalOpen(true);
    setSwapTargetShift(shift);
    setSwapSuggestions([]);
    setSelectedSwapStaffId('');
    setSwapNote('');
    setSwapError(null);
    setSwapSuggestionsLoading(true);

    try {
      const payload = await listEligibleSwapStaff(shift._id);
      setSwapSuggestions(payload.suggestions ?? []);
      if (payload.suggestions?.[0]) {
        setSelectedSwapStaffId(payload.suggestions[0].staffId);
      }
    } catch (suggestionsError) {
      setSwapError(getErrorMessage(suggestionsError, 'Failed to load eligible swap candidates'));
    } finally {
      setSwapSuggestionsLoading(false);
    }
  };

  const submitSwapRequest = async () => {
    if (!swapTargetShift || !selectedSwapStaffId) {
      return;
    }

    setCreatingSwap(true);
    setSwapMessage(null);
    setSwapError(null);

    try {
      await createSwapRequest({
        type: 'swap',
        shiftId: swapTargetShift._id,
        toStaffId: selectedSwapStaffId,
        ...(swapNote.trim() ? { note: swapNote.trim() } : {}),
      });

      setSwapModalOpen(false);
      setSwapTargetShift(null);
      setSwapSuggestions([]);
      setSelectedSwapStaffId('');
      setSwapNote('');
      setSwapMessage('Swap request submitted. Waiting for staff acceptance and manager approval.');
      await loadSwapData();
    } catch (submitError) {
      setSwapError(getErrorMessage(submitError, 'Failed to submit swap request'));
    } finally {
      setCreatingSwap(false);
    }
  };

  const submitDropRequest = async (shiftId: string) => {
    setDropShiftId(shiftId);
    setSwapMessage(null);
    setSwapError(null);

    try {
      await createSwapRequest({
        type: 'drop',
        shiftId,
      });

      setSwapMessage('Drop request submitted. It will expire 24 hours before shift start if unclaimed.');
      await loadSwapData();
    } catch (submitError) {
      setSwapError(getErrorMessage(submitError, 'Failed to create drop request'));
    } finally {
      setDropShiftId(null);
    }
  };

  const cancelRequest = async (requestId: string) => {
    setActionRequestId(requestId);
    setSwapMessage(null);
    setSwapError(null);

    try {
      await cancelSwapRequest(requestId);
      setSwapMessage('Request cancelled.');
      await loadSwapData();
    } catch (cancelError) {
      setSwapError(getErrorMessage(cancelError, 'Failed to cancel request'));
    } finally {
      setActionRequestId(null);
    }
  };

  const acceptRequest = async (requestId: string) => {
    setActionRequestId(requestId);
    setSwapMessage(null);
    setSwapError(null);

    try {
      await acceptSwapRequest(requestId);
      setSwapMessage('Swap accepted. Waiting for manager approval.');
      await loadSwapData();
    } catch (acceptError) {
      setSwapError(getErrorMessage(acceptError, 'Failed to accept swap request'));
    } finally {
      setActionRequestId(null);
    }
  };

  const claimRequest = async (requestId: string) => {
    setActionRequestId(requestId);
    setSwapMessage(null);
    setSwapError(null);

    try {
      await claimDropRequest(requestId);
      setSwapMessage('Drop request claimed. Waiting for manager approval.');
      await loadSwapData();
    } catch (claimError) {
      setSwapError(getErrorMessage(claimError, 'Failed to claim drop request'));
    } finally {
      setActionRequestId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Staff Workspace</p>
          <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-ink">
            Shift Exchange & Coverage
          </h2>
          <p className="text-sm text-slate-600">Request swaps, offer drops, and claim available coverage.</p>
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

      {swapMessage ? (
        <section className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {swapMessage}
        </section>
      ) : null}
      {swapError ? (
        <section className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {swapError}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <article id="my-shifts" className="panel p-5 scroll-mt-24">
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-primary" onClick={() => void openSwapModal(shift)}>
                      Request Swap
                    </button>
                    <button
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs"
                      disabled={dropShiftId === shift._id}
                      onClick={() => void submitDropRequest(shift._id)}
                    >
                      {dropShiftId === shift._id ? 'Submitting...' : 'Drop Shift'}
                    </button>
                  </div>
                </li>
              ))}
              {!loading && myShifts.length === 0 ? (
                <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  You have no assigned shifts this week.
                </li>
              ) : null}
            </ul>
          </article>

          <article id="swap-requests" className="panel p-5 scroll-mt-24">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">My Swap & Drop Requests</h2>
            {swapLoading ? <p className="mt-3 text-sm text-slate-500">Loading requests...</p> : null}
            <ul className="mt-3 space-y-3">
              {myRequests.map((request) => {
                const canCancel =
                  ['pending', 'accepted', 'claimed'].includes(request.status) &&
                  request.fromStaff.id === user.id;
                const canAccept =
                  request.type === 'swap' &&
                  request.status === 'pending' &&
                  request.toStaff?.id === user.id;

                return (
                  <li key={request._id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {request.type === 'swap' ? 'Swap' : 'Drop'} - {request.shift.title}
                      </p>
                      <span className={`rounded-full px-2 py-1 text-xs ${statusTone(request.status)}`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {request.shift.localDate} {request.shift.startLocalTime}-{request.shift.endLocalTime}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      From: {request.fromStaff.name}
                      {request.toStaff ? ` | To: ${request.toStaff.name}` : ''}
                    </p>
                    {request.note ? <p className="mt-1 text-xs text-slate-600">Note: {request.note}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canAccept ? (
                        <button
                          className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs text-blue-700"
                          disabled={actionRequestId === request._id}
                          onClick={() => void acceptRequest(request._id)}
                        >
                          {actionRequestId === request._id ? 'Accepting...' : 'Accept'}
                        </button>
                      ) : null}
                      {canCancel ? (
                        <button
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs"
                          disabled={actionRequestId === request._id}
                          onClick={() => void cancelRequest(request._id)}
                        >
                          {actionRequestId === request._id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {!swapLoading && myRequests.length === 0 ? (
                <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  You have no swap/drop requests.
                </li>
              ) : null}
            </ul>
          </article>

          <article id="available-drops" className="panel p-5 scroll-mt-24">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">Available Drop Requests</h2>
            <ul className="mt-3 space-y-3">
              {availableDrops.map((request) => (
                <li key={request._id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{request.shift.title}</p>
                    <span className={`rounded-full px-2 py-1 text-xs ${statusTone(request.status)}`}>
                      {request.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {request.shift.localDate} {request.shift.startLocalTime}-{request.shift.endLocalTime}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Requested by: {request.fromStaff.name}</p>
                  <button
                    className="mt-3 rounded-md border border-slate-300 px-3 py-1 text-xs"
                    disabled={actionRequestId === request._id}
                    onClick={() => void claimRequest(request._id)}
                  >
                    {actionRequestId === request._id ? 'Claiming...' : 'Claim Shift'}
                  </button>
                </li>
              ))}
              {!swapLoading && availableDrops.length === 0 ? (
                <li className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No claimable drop requests right now.
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

      {swapModalOpen ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="panel w-full max-w-lg p-5">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">Request Shift Swap</h2>
            <p className="mt-1 text-sm text-slate-600">
              {swapTargetShift
                ? `${swapTargetShift.title} on ${swapTargetShift.localDate} ${swapTargetShift.startLocalTime}-${swapTargetShift.endLocalTime}`
                : ''}
            </p>

            <div className="mt-4 space-y-3">
              {swapSuggestionsLoading ? <p className="text-sm text-slate-500">Loading eligible staff...</p> : null}
              <label>
                <span className="mb-1 block text-xs text-slate-500">Eligible staff suggestions</span>
                <select
                  className="input"
                  value={selectedSwapStaffId}
                  onChange={(event) => setSelectedSwapStaffId(event.target.value)}
                >
                  <option value="">Select staff member...</option>
                  {swapSuggestions.map((suggestion) => (
                    <option key={suggestion.staffId} value={suggestion.staffId}>
                      {suggestion.name}
                    </option>
                  ))}
                </select>
              </label>
              {swapSuggestions.length > 0 ? (
                <p className="text-xs text-slate-500">
                  {swapSuggestions.find((entry) => entry.staffId === selectedSwapStaffId)?.reason ??
                    'Selected staff must still pass checks at acceptance and approval.'}
                </p>
              ) : null}
              {!swapSuggestionsLoading && swapSuggestions.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-600">
                  No eligible staff suggestions were found for this shift right now.
                </p>
              ) : null}
              <label>
                <span className="mb-1 block text-xs text-slate-500">Optional note</span>
                <textarea
                  className="input min-h-20"
                  value={swapNote}
                  onChange={(event) => setSwapNote(event.target.value)}
                  placeholder="Reason for swap request"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
                onClick={() => {
                  setSwapModalOpen(false);
                  setSwapTargetShift(null);
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={!selectedSwapStaffId || creatingSwap}
                onClick={() => void submitSwapRequest()}
              >
                {creatingSwap ? 'Submitting...' : 'Submit Swap Request'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
