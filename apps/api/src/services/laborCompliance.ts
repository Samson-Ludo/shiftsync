import { ClientSession, Types } from 'mongoose';
import { DateTime } from 'luxon';
import { ShiftAssignmentModel, ShiftModel } from '../models/index.js';

export const WEEKLY_WARNING_HOURS = 35;
export const WEEKLY_OVERTIME_HOURS = 40;
export const DAILY_WARNING_HOURS = 8;
export const DAILY_BLOCK_HOURS = 12;
export const SIXTH_DAY_WARNING = 6;
export const SEVENTH_DAY_OVERRIDE_REQUIRED = 7;

export type LaborComplianceWarningCode =
  | 'WEEKLY_HOURS_35_PLUS'
  | 'WEEKLY_HOURS_OVER_40'
  | 'DAILY_HOURS_OVER_8'
  | 'SIXTH_CONSECUTIVE_DAY'
  | 'SEVENTH_DAY_OVERRIDE_APPLIED';

export type LaborComplianceWarning = {
  code: LaborComplianceWarningCode;
  message: string;
  details: Record<string, unknown>;
};

export type LaborComplianceImpact = {
  projectedWeeklyHours: number;
  projectedDailyHours: number;
  consecutiveDaysAfterAssignment: number;
  warnings: LaborComplianceWarning[];
};

type ShiftWindow = {
  shiftId: string;
  startAtUtc: string;
  endAtUtc: string;
};

export type StaffWeekLaborSnapshot = {
  weekStartLocal: string;
  timezone: string;
  totalWeeklyHours: number;
  dailyTotals: Record<string, number>;
  workedDates: string[];
};

const toUtcDateTime = (iso: string): DateTime => DateTime.fromISO(iso, { zone: 'utc' });

const roundToTwo = (value: number): number => Number(value.toFixed(2));

const getWeekWindow = (weekStartLocal: string, timezone: string): { weekStart: DateTime; weekEnd: DateTime } => {
  const weekStart = DateTime.fromISO(weekStartLocal, { zone: timezone }).startOf('day');
  const weekEnd = weekStart.plus({ days: 7 });

  return { weekStart, weekEnd };
};

export const calculateShiftDurationHours = (shiftStartAtUtc: string, shiftEndAtUtc: string): number => {
  const start = toUtcDateTime(shiftStartAtUtc);
  const end = toUtcDateTime(shiftEndAtUtc);

  return roundToTwo(Math.max(0, end.diff(start, 'hours').hours));
};

const overlapsWeek = (
  shiftStartUtc: string,
  shiftEndUtc: string,
  timezone: string,
  weekStart: DateTime,
  weekEnd: DateTime,
): boolean => {
  const shiftStart = toUtcDateTime(shiftStartUtc).setZone(timezone);
  const shiftEnd = toUtcDateTime(shiftEndUtc).setZone(timezone);

  return shiftStart < weekEnd && shiftEnd > weekStart;
};

const addIntervalToDailyTotals = (args: {
  dailyTotals: Record<string, number>;
  workedDates: Set<string>;
  timezone: string;
  startAtUtc: string;
  endAtUtc: string;
  weekStart: DateTime;
  weekEnd: DateTime;
}): number => {
  const originalStart = toUtcDateTime(args.startAtUtc).setZone(args.timezone);
  const originalEnd = toUtcDateTime(args.endAtUtc).setZone(args.timezone);

  if (!originalStart.isValid || !originalEnd.isValid || originalEnd <= originalStart) {
    return 0;
  }

  const start = originalStart < args.weekStart ? args.weekStart : originalStart;
  const end = originalEnd > args.weekEnd ? args.weekEnd : originalEnd;

  if (end <= start) {
    return 0;
  }

  let cursor = start;
  let totalHours = 0;

  while (cursor < end) {
    const nextDay = cursor.startOf('day').plus({ days: 1 });
    const segmentEnd = end < nextDay ? end : nextDay;
    const segmentHours = segmentEnd.diff(cursor, 'hours').hours;

    if (segmentHours > 0) {
      const dayIso = cursor.toISODate();
      if (dayIso) {
        args.dailyTotals[dayIso] = roundToTwo((args.dailyTotals[dayIso] ?? 0) + segmentHours);
        args.workedDates.add(dayIso);
      }
      totalHours += segmentHours;
    }

    cursor = segmentEnd;
  }

  return roundToTwo(totalHours);
};

const fetchAssignedShiftWindows = async (args: {
  staffId: Types.ObjectId;
  session?: ClientSession;
}): Promise<ShiftWindow[]> => {
  const assignmentQuery = ShiftAssignmentModel.find({
    staffId: args.staffId,
    status: 'assigned',
  }).select('shiftId');

  if (args.session) {
    assignmentQuery.session(args.session);
  }

  const assignments = await assignmentQuery.lean();
  if (assignments.length === 0) {
    return [];
  }

  const shiftQuery = ShiftModel.find({
    _id: { $in: assignments.map((assignment) => assignment.shiftId) },
  }).select('_id startAtUtc endAtUtc');

  if (args.session) {
    shiftQuery.session(args.session);
  }

  const shifts = await shiftQuery.lean();

  return shifts.map((shift) => ({
    shiftId: shift._id.toString(),
    startAtUtc: shift.startAtUtc,
    endAtUtc: shift.endAtUtc,
  }));
};

export const computeConsecutiveDaysEndingOnDate = (args: {
  workedDates: Set<string>;
  targetDateLocal: string;
  weekStartLocal: string;
  timezone: string;
}): number => {
  const target = DateTime.fromISO(args.targetDateLocal, { zone: args.timezone }).startOf('day');
  const weekStart = DateTime.fromISO(args.weekStartLocal, { zone: args.timezone }).startOf('day');

  if (!target.isValid || !weekStart.isValid) {
    return 0;
  }

  let cursor = target;
  let consecutive = 0;

  while (cursor >= weekStart) {
    const dayIso = cursor.toISODate();
    if (!dayIso || !args.workedDates.has(dayIso)) {
      break;
    }

    consecutive += 1;
    cursor = cursor.minus({ days: 1 });
  }

  return consecutive;
};

export const computeLaborComplianceForWeek = async (args: {
  staffId: Types.ObjectId;
  weekStartLocal: string;
  timezone: string;
  includeShiftWindowUtc?: { startAtUtc: string; endAtUtc: string };
  session?: ClientSession;
}): Promise<StaffWeekLaborSnapshot> => {
  const { weekStart, weekEnd } = getWeekWindow(args.weekStartLocal, args.timezone);
  const assignedShiftWindows = await fetchAssignedShiftWindows({
    staffId: args.staffId,
    session: args.session,
  });

  const dailyTotals: Record<string, number> = {};
  const workedDates = new Set<string>();
  let totalWeeklyHours = 0;

  for (const shift of assignedShiftWindows) {
    if (!overlapsWeek(shift.startAtUtc, shift.endAtUtc, args.timezone, weekStart, weekEnd)) {
      continue;
    }

    totalWeeklyHours += addIntervalToDailyTotals({
      dailyTotals,
      workedDates,
      timezone: args.timezone,
      startAtUtc: shift.startAtUtc,
      endAtUtc: shift.endAtUtc,
      weekStart,
      weekEnd,
    });
  }

  if (args.includeShiftWindowUtc) {
    totalWeeklyHours += addIntervalToDailyTotals({
      dailyTotals,
      workedDates,
      timezone: args.timezone,
      startAtUtc: args.includeShiftWindowUtc.startAtUtc,
      endAtUtc: args.includeShiftWindowUtc.endAtUtc,
      weekStart,
      weekEnd,
    });
  }

  return {
    weekStartLocal: args.weekStartLocal,
    timezone: args.timezone,
    totalWeeklyHours: roundToTwo(totalWeeklyHours),
    dailyTotals,
    workedDates: Array.from(workedDates).sort(),
  };
};

export const getLocalDateForUtcInTimezone = (utcIso: string, timezone: string): string => {
  return DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(timezone).toISODate() ?? '';
};
