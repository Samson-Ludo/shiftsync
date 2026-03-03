import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  ApiError,
  AssignmentValidationResponse,
  CurrentUser,
  ShiftItem,
  ShiftAuditItem,
  StaffOption,
  SwapRequestItem,
  approveSwapRequest,
  assignStaff,
  createShift as createShiftRequest,
  getShiftAudit,
  listShifts,
  listStaff,
  listSwapRequests,
  rejectSwapRequest,
  validateAssign,
} from '@/lib/api';
import { getToken } from '@/lib/api/auth';
import { getSocket } from '@/lib/socket';
import { NotificationCenter } from './notification-center';
import { CardListSkeleton } from './skeleton/CardListSkeleton';
import { EmptyState } from './state/EmptyState';
import { ErrorState } from './state/ErrorState';

const mondayIso = () => DateTime.now().startOf('week').toISODate() ?? DateTime.now().toISODate()!;
const seventhDayOverrideCode = 'SEVENTH_CONSECUTIVE_DAY_REQUIRES_OVERRIDE';

type CreateFormState = {
  title: string;
  requiredSkill: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
};

type RealtimeBanner = {
  tone: 'conflict' | 'info';
  message: string;
} | null;

type ConflictDetectedEvent = {
  message?: string;
};

type AssignmentCreatedEvent = {
  locationId?: string;
  staffName?: string;
};

type LocationEventPayload = {
  locationId?: string;
};

const initialCreateForm: CreateFormState = {
  title: 'New Shift',
  requiredSkill: 'line_cook',
  localDate: DateTime.now().toISODate() ?? '',
  startLocalTime: '09:00',
  endLocalTime: '17:00',
};

const emptyComplianceImpact: AssignmentValidationResponse['complianceImpact'] = {
  projectedWeeklyHours: 0,
  projectedDailyHours: 0,
  consecutiveDaysAfterAssignment: 0,
  warnings: [],
};

const fallbackValidation: AssignmentValidationResponse = {
  ok: false,
  violations: [],
  suggestions: [],
  complianceImpact: emptyComplianceImpact,
};

const toValidationResponse = (data: unknown): AssignmentValidationResponse | null => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const maybeValidation = data as Partial<AssignmentValidationResponse>;

  return {
    ok: Boolean(maybeValidation.ok),
    violations: Array.isArray(maybeValidation.violations)
      ? (maybeValidation.violations as AssignmentValidationResponse['violations'])
      : [],
    suggestions: Array.isArray(maybeValidation.suggestions)
      ? (maybeValidation.suggestions as AssignmentValidationResponse['suggestions'])
      : [],
    complianceImpact:
      maybeValidation.complianceImpact && typeof maybeValidation.complianceImpact === 'object'
        ? {
            projectedWeeklyHours:
              typeof maybeValidation.complianceImpact.projectedWeeklyHours === 'number'
                ? maybeValidation.complianceImpact.projectedWeeklyHours
                : 0,
            projectedDailyHours:
              typeof maybeValidation.complianceImpact.projectedDailyHours === 'number'
                ? maybeValidation.complianceImpact.projectedDailyHours
                : 0,
            consecutiveDaysAfterAssignment:
              typeof maybeValidation.complianceImpact.consecutiveDaysAfterAssignment === 'number'
                ? maybeValidation.complianceImpact.consecutiveDaysAfterAssignment
                : 0,
            warnings: Array.isArray(maybeValidation.complianceImpact.warnings)
              ? maybeValidation.complianceImpact.warnings
              : [],
          }
        : emptyComplianceImpact,
  };
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError && error.message) {
    return error.message;
  }

  return fallback;
};

const swapStatusTone = (status: SwapRequestItem['status']): string => {
  if (status === 'approved') {
    return 'bg-green-100 text-green-700';
  }

  if (status === 'rejected' || status === 'cancelled' || status === 'expired') {
    return 'bg-red-100 text-red-700';
  }

  if (status === 'accepted' || status === 'claimed') {
    return 'bg-blue-100 text-blue-700';
  }

  return 'bg-amber-100 text-amber-700';
};

const complianceWarningTone = (code: string): string => {
  if (code === 'WEEKLY_HOURS_OVER_40') {
    return 'border-amber-300 bg-amber-50 text-amber-800';
  }

  if (code === 'SEVENTH_DAY_OVERRIDE_APPLIED') {
    return 'border-blue-300 bg-blue-50 text-blue-800';
  }

  return 'border-yellow-300 bg-yellow-50 text-yellow-800';
};

export function ManagerDashboard({ user }: { user: CurrentUser }) {
  const locations = useMemo(() => user.managerLocations ?? [], [user.managerLocations]);
  const [locationId, setLocationId] = useState(locations[0]?._id ?? '');
  const [weekStart, setWeekStart] = useState(mondayIso());
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState('');
  const [validation, setValidation] = useState<AssignmentValidationResponse | null>(null);
  const [activeShiftPanel, setActiveShiftPanel] = useState<'assign' | 'history'>('assign');
  const [shiftAudit, setShiftAudit] = useState<ShiftAuditItem[]>([]);
  const [shiftAuditLoading, setShiftAuditLoading] = useState(false);
  const [shiftAuditError, setShiftAuditError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [realtimeBanner, setRealtimeBanner] = useState<RealtimeBanner>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(initialCreateForm);

  const [swapInbox, setSwapInbox] = useState<SwapRequestItem[]>([]);
  const [swapInboxLoading, setSwapInboxLoading] = useState(false);
  const [swapInboxMessage, setSwapInboxMessage] = useState<string | null>(null);
  const [swapActionRequestId, setSwapActionRequestId] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const selectedLocation = useMemo(
    () => locations.find((location) => location._id === locationId),
    [locations, locationId],
  );

  const selectedShift = useMemo(
    () => shifts.find((shift) => shift._id === selectedShiftId) ?? null,
    [shifts, selectedShiftId],
  );

  const selectedStaff = useMemo(
    () => staffOptions.find((staff) => staff.id === selectedStaffId) ?? null,
    [staffOptions, selectedStaffId],
  );

  const hardBlocks = useMemo(() => validation?.violations ?? [], [validation]);
  const seventhDayBlock = useMemo(
    () => hardBlocks.some((violation) => violation.code === seventhDayOverrideCode),
    [hardBlocks],
  );
  const otherHardBlocks = useMemo(
    () => hardBlocks.filter((violation) => violation.code !== seventhDayOverrideCode),
    [hardBlocks],
  );

  const canAssignWithOverride =
    seventhDayBlock &&
    otherHardBlocks.length === 0 &&
    overrideReason.trim().length > 0 &&
    Boolean(selectedStaffId);
  const canAssignNormally = Boolean(validation?.ok && selectedStaffId);
  const canAssign = !assigning && (canAssignNormally || canAssignWithOverride);
  const showShiftsSkeleton = loading && shifts.length === 0;
  const showSwapSkeleton = swapInboxLoading && swapInbox.length === 0;
  const showShiftHistorySkeleton =
    activeShiftPanel === 'history' && shiftAuditLoading && shiftAudit.length === 0;

  const loadShifts = useCallback(async () => {
    if (!locationId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await listShifts(locationId, weekStart);
      const nextShifts = payload.shifts ?? [];
      setShifts(nextShifts);

      if (nextShifts.length === 0) {
        setSelectedShiftId(null);
        setValidation(null);
      } else if (!selectedShiftId || !nextShifts.some((shift) => shift._id === selectedShiftId)) {
        setSelectedShiftId(nextShifts[0]._id);
        setValidation(null);
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to load shifts'));
    } finally {
      setLoading(false);
    }
  }, [locationId, weekStart, selectedShiftId]);

  const loadStaffOptions = useCallback(async () => {
    if (!locationId) {
      return;
    }

    setStaffLoading(true);

    try {
      const payload = await listStaff(locationId);
      setStaffOptions(payload.staff ?? []);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to load staff'));
    } finally {
      setStaffLoading(false);
    }
  }, [locationId]);

  const loadSwapInbox = useCallback(async () => {
    if (!locationId) {
      return;
    }

    setSwapInboxLoading(true);

    try {
      const payload = await listSwapRequests({ managerInbox: true });
      const rows = payload.swapRequests ?? [];
      setSwapInbox(rows.filter((request) => request.shift.locationId === locationId));
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to load manager swap inbox'));
    } finally {
      setSwapInboxLoading(false);
    }
  }, [locationId]);

  const loadShiftAudit = useCallback(async () => {
    if (!selectedShiftId) {
      setShiftAudit([]);
      setShiftAuditError(null);
      return;
    }

    setShiftAuditLoading(true);
    setShiftAuditError(null);

    try {
      const payload = await getShiftAudit(selectedShiftId, 50);
      setShiftAudit(payload.logs ?? []);
    } catch (auditError) {
      setShiftAuditError(getErrorMessage(auditError, 'Failed to load shift history'));
      setShiftAudit([]);
    } finally {
      setShiftAuditLoading(false);
    }
  }, [selectedShiftId]);

  const runValidation = useCallback(async () => {
    if (!selectedShiftId || !selectedStaffId) {
      setValidation(null);
      return;
    }

    setValidating(true);
    setAssignmentMessage(null);

    try {
      const payload = await validateAssign(selectedShiftId, selectedStaffId);
      setValidation(payload);
    } catch (validationError) {
      if (validationError instanceof ApiError && validationError.status === 409) {
        setValidation(toValidationResponse(validationError.data) ?? fallbackValidation);
      } else {
        setError(getErrorMessage(validationError, 'Failed to validate assignment'));
        setValidation(null);
      }
    } finally {
      setValidating(false);
    }
  }, [selectedShiftId, selectedStaffId]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  useEffect(() => {
    void loadStaffOptions();
  }, [loadStaffOptions]);

  useEffect(() => {
    void loadSwapInbox();
  }, [loadSwapInbox]);

  useEffect(() => {
    void runValidation();
  }, [runValidation]);

  useEffect(() => {
    if (activeShiftPanel === 'history') {
      void loadShiftAudit();
    }
  }, [activeShiftPanel, loadShiftAudit]);

  useEffect(() => {
    if (!realtimeBanner) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRealtimeBanner(null);
    }, 6000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [realtimeBanner]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      return;
    }

    const socket = getSocket(token, process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000');

    const handleConflictDetected = (payload: ConflictDetectedEvent) => {
      setRealtimeBanner({
        tone: 'conflict',
        message:
          payload.message ??
          'Assignment conflict detected. Another manager updated this staff assignment.',
      });
    };

    const handleAssignmentCreated = (payload: AssignmentCreatedEvent) => {
      if (!payload.locationId || payload.locationId !== locationId) {
        return;
      }

      setRealtimeBanner({
        tone: 'info',
        message: `Live update: ${payload.staffName ?? 'A staff member'} was assigned.`,
      });

      void loadShifts();
    };

    const handleLocationRefreshEvent = (payload: LocationEventPayload) => {
      if (!payload.locationId || payload.locationId !== locationId) {
        return;
      }

      void loadShifts();
      void loadSwapInbox();
      if (activeShiftPanel === 'history') {
        void loadShiftAudit();
      }
    };

    socket.on('conflict_detected', handleConflictDetected);
    socket.on('assignment_created', handleAssignmentCreated);
    socket.on('assignment_removed', handleLocationRefreshEvent);
    socket.on('shift_created', handleLocationRefreshEvent);
    socket.on('shift_updated', handleLocationRefreshEvent);
    socket.on('schedule_published', handleLocationRefreshEvent);
    socket.on('schedule_updated', handleLocationRefreshEvent);
    socket.on('swap_requested', handleLocationRefreshEvent);
    socket.on('swap_updated', handleLocationRefreshEvent);
    socket.on('swap_cancelled', handleLocationRefreshEvent);

    return () => {
      socket.off('conflict_detected', handleConflictDetected);
      socket.off('assignment_created', handleAssignmentCreated);
      socket.off('assignment_removed', handleLocationRefreshEvent);
      socket.off('shift_created', handleLocationRefreshEvent);
      socket.off('shift_updated', handleLocationRefreshEvent);
      socket.off('schedule_published', handleLocationRefreshEvent);
      socket.off('schedule_updated', handleLocationRefreshEvent);
      socket.off('swap_requested', handleLocationRefreshEvent);
      socket.off('swap_updated', handleLocationRefreshEvent);
      socket.off('swap_cancelled', handleLocationRefreshEvent);
    };
  }, [activeShiftPanel, loadShiftAudit, locationId, loadShifts, loadSwapInbox]);

  const createShift = async () => {
    if (!locationId) {
      setError('Choose a location before creating a shift.');
      return;
    }

    try {
      await createShiftRequest({
        locationId,
        title: createForm.title,
        requiredSkill: createForm.requiredSkill,
        localDate: createForm.localDate,
        startLocalTime: createForm.startLocalTime,
        endLocalTime: createForm.endLocalTime,
      });

      setShowCreateModal(false);
      setCreateForm(initialCreateForm);
      await loadShifts();
    } catch (createError) {
      setError(getErrorMessage(createError, 'Failed to create shift'));
    }
  };

  const assignSelectedStaff = async () => {
    if (!selectedShiftId || !selectedStaffId) {
      return;
    }

    setAssigning(true);
    setAssignmentMessage(null);

    try {
      const payload = await assignStaff(selectedShiftId, selectedStaffId, {
        ...(canAssignWithOverride
          ? {
              override: {
                allowSeventhDay: true,
                reason: overrideReason.trim(),
              },
            }
          : {}),
      });

      setValidation(payload.validation);
      setAssignmentMessage(
        canAssignWithOverride
          ? 'Assignment saved with documented seventh-day override.'
          : 'Assignment saved successfully.',
      );
      setError(null);
      setOverrideReason('');
      await loadShifts();
    } catch (assignError) {
      if (assignError instanceof ApiError && assignError.status === 409) {
        setValidation(toValidationResponse(assignError.data) ?? fallbackValidation);
      }
      setError(getErrorMessage(assignError, 'Unable to assign staff'));
    } finally {
      setAssigning(false);
    }
  };

  const approveSwap = async (swapRequestId: string) => {
    setSwapActionRequestId(swapRequestId);
    setSwapInboxMessage(null);

    try {
      await approveSwapRequest(swapRequestId);
      setSwapInboxMessage('Swap request approved.');
      await Promise.all([loadSwapInbox(), loadShifts()]);
    } catch (approveError) {
      setError(getErrorMessage(approveError, 'Failed to approve swap request'));
    } finally {
      setSwapActionRequestId(null);
    }
  };

  const rejectSwap = async (swapRequestId: string) => {
    const reason = rejectReasons[swapRequestId]?.trim();
    if (!reason) {
      setError('Reject reason is required.');
      return;
    }

    setSwapActionRequestId(swapRequestId);
    setSwapInboxMessage(null);

    try {
      await rejectSwapRequest(swapRequestId, reason);
      setSwapInboxMessage('Swap request rejected.');
      setRejectReasons((current) => ({ ...current, [swapRequestId]: '' }));
      await loadSwapInbox();
    } catch (rejectError) {
      setError(getErrorMessage(rejectError, 'Failed to reject swap request'));
    } finally {
      setSwapActionRequestId(null);
    }
  };

  return (
    <div
      className="space-y-6"
      aria-busy={loading || swapInboxLoading || staffLoading || validating || shiftAuditLoading || assigning || undefined}
    >
      <header className="panel p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Schedule Filters</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs text-slate-500">Location</span>
            <select
              className="input"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setSelectedStaffId('');
                setValidation(null);
                setOverrideReason('');
                setActiveShiftPanel('assign');
                setShiftAudit([]);
                setShiftAuditError(null);
              }}
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

      {error ? <ErrorState message={error} onRetry={() => void loadShifts()} /> : null}

      {realtimeBanner ? (
        <section
          className={`rounded-md border px-4 py-3 text-sm ${
            realtimeBanner.tone === 'conflict'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-cyan-200 bg-cyan-50 text-cyan-800'
          }`}
        >
          {realtimeBanner.message}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <article className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
              Shifts {selectedLocation ? `- ${selectedLocation.code}` : ''}
            </h2>
            <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
              Create Shift
            </button>
          </div>

          {showShiftsSkeleton ? <CardListSkeleton count={4} /> : null}
          <ul className="space-y-3">
            {shifts.map((shift) => (
              <li
                key={shift._id}
                className={`cursor-pointer rounded-md border p-3 ${
                  selectedShiftId === shift._id ? 'border-sea bg-cyan-50' : 'border-slate-200'
                }`}
                onClick={() => {
                  setSelectedShiftId(shift._id);
                  setValidation(null);
                  setAssignmentMessage(null);
                  setOverrideReason('');
                  setActiveShiftPanel('assign');
                  setShiftAudit([]);
                  setShiftAuditError(null);
                }}
              >
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
                <p className="mt-1 text-xs text-slate-500">
                  Required skill: {shift.requiredSkill ?? 'none'} | Assignments: {shift.assignments?.length ?? 0}
                </p>
              </li>
            ))}

            {!loading && shifts.length === 0 ? (
              <li>
                <EmptyState title="No Shifts Found" description="No shifts were found for this location and week." />
              </li>
            ) : null}
          </ul>
        </article>

        <aside className="space-y-4">
          <section className="panel p-5">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">Shift Details</h2>

            {!selectedShift ? (
              <div className="mt-3">
                <EmptyState
                  title="No Shift Selected"
                  description="Select a shift from the list to validate and assign staff."
                />
              </div>
            ) : (
              <div className="mt-3 space-y-4 text-sm">
                <div>
                  <p className="font-medium">{selectedShift.title}</p>
                  <p className="text-slate-600">
                    {selectedShift.localDate} {selectedShift.startLocalTime}-{selectedShift.endLocalTime}
                  </p>
                  <p className="text-slate-600">
                    Required skill: {selectedShift.requiredSkill ?? 'none'}
                  </p>
                </div>

                <div className="inline-flex rounded-md border border-slate-200 p-1 text-xs">
                  <button
                    className={`rounded px-3 py-1 ${
                      activeShiftPanel === 'assign' ? 'bg-cyan-100 text-cyan-800' : 'text-slate-600'
                    }`}
                    onClick={() => setActiveShiftPanel('assign')}
                  >
                    Assign
                  </button>
                  <button
                    className={`rounded px-3 py-1 ${
                      activeShiftPanel === 'history' ? 'bg-cyan-100 text-cyan-800' : 'text-slate-600'
                    }`}
                    onClick={() => setActiveShiftPanel('history')}
                  >
                    History
                  </button>
                </div>

                {activeShiftPanel === 'assign' ? (
                  <>
                    <div>
                      <label>
                        <span className="mb-1 block text-xs text-slate-500">Assign staff</span>
                        <select
                          className="input"
                          value={selectedStaffId}
                          onChange={(event) => {
                            setSelectedStaffId(event.target.value);
                            setValidation(null);
                            setAssignmentMessage(null);
                            setOverrideReason('');
                          }}
                        >
                          <option value="">Select staff member...</option>
                          {staffOptions.map((staff) => (
                            <option key={staff.id} value={staff.id}>
                              {staff.name} ({staff.email})
                            </option>
                          ))}
                        </select>
                      </label>
                      {staffLoading ? <p className="mt-2 text-xs text-slate-500">Loading staff...</p> : null}
                      {selectedStaff ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Skills: {selectedStaff.skills.join(', ') || 'none'}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      {validating ? <p className="text-xs text-slate-500">Validating constraints...</p> : null}

                      {validation?.ok ? (
                        <p className="rounded-md bg-green-100 p-2 text-xs text-green-700">
                          No hard blocks. You can assign this staff member.
                        </p>
                      ) : null}

                      {hardBlocks.length > 0 ? (
                        <div className="rounded-md border border-red-200 bg-red-50 p-2">
                          <p className="mb-2 text-xs font-semibold text-red-700">Hard blocks</p>
                          <ul className="space-y-1 text-xs text-red-700">
                            {hardBlocks.map((violation, index) => (
                              <li key={`${violation.code}-${index}`}>- {violation.message}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {validation ? (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-700">Compliance what-if impact</p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-700">
                            <p>
                              Weekly Hours:{' '}
                              <span className="font-semibold">{validation.complianceImpact.projectedWeeklyHours}</span>
                            </p>
                            <p>
                              Shift-Day Hours:{' '}
                              <span className="font-semibold">{validation.complianceImpact.projectedDailyHours}</span>
                            </p>
                            <p>
                              Consecutive Days:{' '}
                              <span className="font-semibold">
                                {validation.complianceImpact.consecutiveDaysAfterAssignment}
                              </span>
                            </p>
                          </div>

                          <div className="mt-2 space-y-2">
                            {validation.complianceImpact.warnings.map((warning, index) => (
                              <p
                                key={`${warning.code}-${index}`}
                                className={`rounded-md border p-2 text-xs ${complianceWarningTone(warning.code)}`}
                              >
                                {warning.message}
                              </p>
                            ))}
                            {validation.complianceImpact.warnings.length === 0 ? (
                              <p className="text-xs text-slate-500">No compliance warnings for this assignment.</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {seventhDayBlock && otherHardBlocks.length === 0 ? (
                        <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                          <p className="text-xs font-semibold text-blue-800">
                            Seventh consecutive day requires manager override.
                          </p>
                          <label className="mt-2 block">
                            <span className="mb-1 block text-xs text-blue-700">Override reason (required)</span>
                            <textarea
                              className="input min-h-20 text-xs"
                              value={overrideReason}
                              onChange={(event) => setOverrideReason(event.target.value)}
                              placeholder="Document why this 7th consecutive day assignment is allowed"
                            />
                          </label>
                        </div>
                      ) : null}

                      {!validation?.ok && validation?.suggestions?.length ? (
                        <div className="rounded-md bg-slate-100 p-2">
                          <p className="mb-2 text-xs font-semibold text-slate-700">Suggested alternatives</p>
                          <div className="space-y-1">
                            {validation.suggestions.map((suggestion) => (
                              <button
                                key={suggestion.staffId}
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-left text-xs hover:bg-slate-50"
                                onClick={() => {
                                  setSelectedStaffId(suggestion.staffId);
                                  setOverrideReason('');
                                }}
                              >
                                <span className="font-semibold">{suggestion.name}</span>
                                <span className="block text-slate-600">{suggestion.reason}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {assignmentMessage ? (
                        <p className="rounded-md bg-green-100 p-2 text-xs text-green-700">{assignmentMessage}</p>
                      ) : null}
                    </div>

                    <button
                      className="btn-primary w-full"
                      disabled={!canAssign}
                      onClick={() => void assignSelectedStaff()}
                    >
                      {assigning
                        ? 'Assigning...'
                        : canAssignWithOverride
                          ? 'Confirm Assign with Override'
                          : 'Confirm Assign'}
                    </button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <button
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                      onClick={() => void loadShiftAudit()}
                    >
                      Refresh History
                    </button>
                    {showShiftHistorySkeleton ? <CardListSkeleton count={3} showBadge={false} /> : null}
                    {shiftAuditError ? (
                      <ErrorState title="History Load Failed" message={shiftAuditError} onRetry={() => void loadShiftAudit()} />
                    ) : null}
                    <ul className="space-y-2">
                      {shiftAudit.map((entry) => (
                        <li key={entry._id} className="rounded-md border border-slate-200 p-2 text-xs">
                          <p className="font-semibold text-slate-800">{entry.action}</p>
                          <p className="text-slate-500">
                            {new Date(entry.createdAt).toLocaleString()} by {entry.actorName ?? entry.actorId}
                          </p>
                          {entry.beforeSnapshot ? (
                            <pre className="mt-1 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                              before: {JSON.stringify(entry.beforeSnapshot)}
                            </pre>
                          ) : null}
                          {entry.afterSnapshot ? (
                            <pre className="mt-1 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                              after: {JSON.stringify(entry.afterSnapshot)}
                            </pre>
                          ) : null}
                        </li>
                      ))}
                      {!shiftAuditLoading && shiftAudit.length === 0 ? (
                        <li>
                          <EmptyState
                            title="No History Entries"
                            description="No audit history entries were found for this shift yet."
                          />
                        </li>
                      ) : null}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <section id="swap-inbox" className="panel p-5 scroll-mt-24">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
              Swap / Coverage Inbox
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Requests become actionable after staff acceptance or drop claim.
            </p>
            {swapInboxMessage ? (
              <p className="mt-3 rounded-md bg-green-100 p-2 text-xs text-green-700">{swapInboxMessage}</p>
            ) : null}
            {showSwapSkeleton ? <CardListSkeleton className="mt-3" count={3} /> : null}
            <ul className="mt-3 space-y-3">
              {swapInbox.map((request) => (
                <li key={request._id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {request.type === 'swap' ? 'Swap' : 'Drop'} - {request.shift.title}
                    </p>
                    <span className={`rounded-full px-2 py-1 text-xs ${swapStatusTone(request.status)}`}>
                      {request.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {request.shift.localDate} {request.shift.startLocalTime}-{request.shift.endLocalTime}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    From: {request.fromStaff.name}
                    {request.toStaff ? ` | To: ${request.toStaff.name}` : ''}
                  </p>
                  <textarea
                    className="input mt-2 min-h-16 text-xs"
                    placeholder="Reject reason"
                    value={rejectReasons[request._id] ?? ''}
                    onChange={(event) =>
                      setRejectReasons((current) => ({ ...current, [request._id]: event.target.value }))
                    }
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      className="rounded-md border border-green-300 bg-green-50 px-3 py-1 text-xs text-green-700"
                      disabled={swapActionRequestId === request._id}
                      onClick={() => void approveSwap(request._id)}
                    >
                      {swapActionRequestId === request._id ? 'Saving...' : 'Approve'}
                    </button>
                    <button
                      className="rounded-md border border-red-300 bg-red-50 px-3 py-1 text-xs text-red-700"
                      disabled={swapActionRequestId === request._id}
                      onClick={() => void rejectSwap(request._id)}
                    >
                      {swapActionRequestId === request._id ? 'Saving...' : 'Reject'}
                    </button>
                  </div>
                </li>
              ))}
              {!swapInboxLoading && swapInbox.length === 0 ? (
                <li>
                  <EmptyState
                    title="No Coverage Requests"
                    description="There are no pending swap or drop approvals for this location."
                  />
                </li>
              ) : null}
            </ul>
          </section>

          <NotificationCenter />
        </aside>
      </section>

      {showCreateModal ? (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="panel w-full max-w-md p-5">
            <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">Create Shift</h2>
            <div className="mt-4 space-y-3">
              <input
                className="input"
                placeholder="Shift title"
                value={createForm.title}
                onChange={(event) => setCreateForm((curr) => ({ ...curr, title: event.target.value }))}
              />
              <input
                className="input"
                placeholder="Required skill (e.g. line_cook)"
                value={createForm.requiredSkill}
                onChange={(event) =>
                  setCreateForm((curr) => ({ ...curr, requiredSkill: event.target.value }))
                }
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
              <button
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void createShift()}>
                Save Shift
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
