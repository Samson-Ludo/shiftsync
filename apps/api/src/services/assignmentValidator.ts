import { ClientSession, Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  AvailabilityExceptionModel,
  AvailabilityRuleModel,
  LocationModel,
  ShiftAssignmentModel,
  ShiftModel,
  StaffCertificationModel,
  StaffSkillModel,
  UserModel,
} from '../models/index.js';

const MIN_REST_HOURS = 10;
const SUGGESTION_LIMIT = 5;

export type AssignmentViolation = {
  code:
    | 'INVALID_INPUT'
    | 'SHIFT_NOT_FOUND'
    | 'STAFF_NOT_FOUND'
    | 'ALREADY_ASSIGNED'
    | 'LOCATION_CERTIFICATION_REQUIRED'
    | 'REQUIRED_SKILL_MISSING'
    | 'AVAILABILITY_VIOLATION'
    | 'DOUBLE_BOOKING'
    | 'MIN_REST_NOT_MET';
  message: string;
  details: Record<string, unknown>;
};

export type AssignmentSuggestion = {
  staffId: string;
  name: string;
  reason: string;
};

export type ValidateAssignmentResult = {
  ok: boolean;
  violations: AssignmentViolation[];
  suggestions: AssignmentSuggestion[];
};

type ValidateAssignmentInput = {
  shiftId: string;
  staffId: string;
  actorId: string;
  session?: ClientSession;
};

type UtcInterval = {
  start: DateTime;
  end: DateTime;
};

type ExistingShiftWindow = {
  shiftId: string;
  title: string;
  startAtUtc: string;
  endAtUtc: string;
};

type TemporalViolationInput = {
  shiftId: string;
  startAtUtc: string;
  endAtUtc: string;
  title: string;
};

const toUtc = (iso: string): DateTime => DateTime.fromISO(iso, { zone: 'utc' });

const mergeIntervals = (intervals: UtcInterval[]): UtcInterval[] => {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const merged: UtcInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end) {
      previous.end = current.end > previous.end ? current.end : previous.end;
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
};

const subtractInterval = (source: UtcInterval[], blocked: UtcInterval): UtcInterval[] => {
  const next: UtcInterval[] = [];

  for (const interval of source) {
    if (blocked.end <= interval.start || blocked.start >= interval.end) {
      next.push(interval);
      continue;
    }

    if (blocked.start > interval.start) {
      next.push({ start: interval.start, end: blocked.start });
    }

    if (blocked.end < interval.end) {
      next.push({ start: blocked.end, end: interval.end });
    }
  }

  return next;
};

const isCoveredByIntervals = (target: UtcInterval, availableIntervals: UtcInterval[]): boolean => {
  const merged = mergeIntervals(availableIntervals);
  let cursor = target.start;

  for (const interval of merged) {
    if (interval.end <= cursor) {
      continue;
    }

    if (interval.start > cursor) {
      return false;
    }

    if (interval.start <= cursor && interval.end > cursor) {
      cursor = interval.end;
    }

    if (cursor >= target.end) {
      return true;
    }
  }

  return cursor >= target.end;
};

const buildWindow = (dateIso: string, startLocalTime: string, endLocalTime: string, timezone: string): UtcInterval => {
  const startLocal = DateTime.fromISO(`${dateIso}T${startLocalTime}`, { zone: timezone });
  let endLocal = DateTime.fromISO(`${dateIso}T${endLocalTime}`, { zone: timezone });

  if (endLocal <= startLocal) {
    endLocal = endLocal.plus({ days: 1 });
  }

  return {
    start: startLocal.toUTC(),
    end: endLocal.toUTC(),
  };
};

const buildFullDayWindow = (dateIso: string, timezone: string): UtcInterval => {
  const startLocal = DateTime.fromISO(dateIso, { zone: timezone }).startOf('day');
  return {
    start: startLocal.toUTC(),
    end: startLocal.plus({ days: 1 }).toUTC(),
  };
};

const listShiftDates = (shiftStartUtc: string, shiftEndUtc: string, timezone: string): string[] => {
  const localStart = toUtc(shiftStartUtc).setZone(timezone).startOf('day');
  const localEnd = toUtc(shiftEndUtc).setZone(timezone).startOf('day');

  const dates: string[] = [];
  let cursor = localStart;

  while (cursor <= localEnd) {
    dates.push(cursor.toISODate() ?? '');
    cursor = cursor.plus({ days: 1 });
  }

  return dates.filter(Boolean);
};

const listWeekdays = (dateIsos: string[], timezone: string): number[] => {
  return Array.from(
    new Set(
      dateIsos.map((dateIso) => DateTime.fromISO(dateIso, { zone: timezone }).weekday),
    ),
  );
};

export const hasOverlap = (
  existingStartAtUtc: string,
  existingEndAtUtc: string,
  newStartAtUtc: string,
  newEndAtUtc: string,
): boolean => {
  const existingStart = toUtc(existingStartAtUtc);
  const existingEnd = toUtc(existingEndAtUtc);
  const newStart = toUtc(newStartAtUtc);
  const newEnd = toUtc(newEndAtUtc);

  return existingStart < newEnd && existingEnd > newStart;
};

const restGapHours = (endAtUtc: string, startAtUtc: string): number => {
  return toUtc(startAtUtc).diff(toUtc(endAtUtc), 'hours').hours;
};

export const evaluateTemporalViolations = (
  targetShift: TemporalViolationInput,
  existingShifts: ExistingShiftWindow[],
): AssignmentViolation[] => {
  const violations: AssignmentViolation[] = [];

  for (const existing of existingShifts) {
    if (hasOverlap(existing.startAtUtc, existing.endAtUtc, targetShift.startAtUtc, targetShift.endAtUtc)) {
      violations.push({
        code: 'DOUBLE_BOOKING',
        message: `Overlaps with assigned shift \"${existing.title}\".`,
        details: {
          existingShiftId: existing.shiftId,
          existingTitle: existing.title,
          existingStartAtUtc: existing.startAtUtc,
          existingEndAtUtc: existing.endAtUtc,
          targetShiftId: targetShift.shiftId,
          targetStartAtUtc: targetShift.startAtUtc,
          targetEndAtUtc: targetShift.endAtUtc,
        },
      });
      continue;
    }

    if (toUtc(existing.endAtUtc) <= toUtc(targetShift.startAtUtc)) {
      const gap = restGapHours(existing.endAtUtc, targetShift.startAtUtc);
      if (gap < MIN_REST_HOURS) {
        violations.push({
          code: 'MIN_REST_NOT_MET',
          message: `Only ${gap.toFixed(1)} hours of rest before the new shift; minimum is ${MIN_REST_HOURS} hours.`,
          details: {
            existingShiftId: existing.shiftId,
            existingTitle: existing.title,
            existingEndAtUtc: existing.endAtUtc,
            targetStartAtUtc: targetShift.startAtUtc,
            requiredHours: MIN_REST_HOURS,
            actualHours: Number(gap.toFixed(2)),
          },
        });
      }
    }

    if (toUtc(targetShift.endAtUtc) <= toUtc(existing.startAtUtc)) {
      const gap = restGapHours(targetShift.endAtUtc, existing.startAtUtc);
      if (gap < MIN_REST_HOURS) {
        violations.push({
          code: 'MIN_REST_NOT_MET',
          message: `Only ${gap.toFixed(1)} hours of rest after the new shift; minimum is ${MIN_REST_HOURS} hours.`,
          details: {
            existingShiftId: existing.shiftId,
            existingTitle: existing.title,
            targetEndAtUtc: targetShift.endAtUtc,
            existingStartAtUtc: existing.startAtUtc,
            requiredHours: MIN_REST_HOURS,
            actualHours: Number(gap.toFixed(2)),
          },
        });
      }
    }
  }

  return violations;
};

const evaluateAvailability = async (args: {
  staffId: Types.ObjectId;
  shift: {
    _id: Types.ObjectId;
    locationId: Types.ObjectId;
    timezone: string;
    startAtUtc: string;
    endAtUtc: string;
    title: string;
  };
  session?: ClientSession;
}): Promise<AssignmentViolation[]> => {
  const violations: AssignmentViolation[] = [];
  const dateIsos = listShiftDates(args.shift.startAtUtc, args.shift.endAtUtc, args.shift.timezone);
  const weekdays = listWeekdays(dateIsos, args.shift.timezone);

  const rulesQuery = AvailabilityRuleModel.find({
    staffId: args.staffId,
    dayOfWeek: { $in: weekdays },
    $or: [{ locationId: args.shift.locationId }, { locationId: { $exists: false } }, { locationId: null }],
  });
  if (args.session) {
    rulesQuery.session(args.session);
  }

  const exceptionsQuery = AvailabilityExceptionModel.find({
    staffId: args.staffId,
    dateLocal: { $in: dateIsos },
  });
  if (args.session) {
    exceptionsQuery.session(args.session);
  }

  const [rules, exceptions] = await Promise.all([rulesQuery.lean(), exceptionsQuery.lean()]);

  let availableIntervals: UtcInterval[] = [];

  for (const dateIso of dateIsos) {
    const weekday = DateTime.fromISO(dateIso, { zone: args.shift.timezone }).weekday;
    const dayRules = rules.filter((rule) => rule.dayOfWeek === weekday);
    for (const rule of dayRules) {
      availableIntervals.push(
        buildWindow(dateIso, rule.startLocalTime, rule.endLocalTime, args.shift.timezone),
      );
    }
  }

  const allowExceptions = exceptions.filter(
    (entry) => entry.type === 'allow' || entry.type === 'available',
  );
  const blockExceptions = exceptions.filter(
    (entry) => entry.type === 'block' || entry.type === 'unavailable',
  );

  for (const exception of allowExceptions) {
    availableIntervals.push(
      exception.startLocalTime && exception.endLocalTime
        ? buildWindow(
            exception.dateLocal,
            exception.startLocalTime,
            exception.endLocalTime,
            args.shift.timezone,
          )
        : buildFullDayWindow(exception.dateLocal, args.shift.timezone),
    );
  }

  availableIntervals = mergeIntervals(availableIntervals);

  for (const exception of blockExceptions) {
    const blockedWindow =
      exception.startLocalTime && exception.endLocalTime
        ? buildWindow(
            exception.dateLocal,
            exception.startLocalTime,
            exception.endLocalTime,
            args.shift.timezone,
          )
        : buildFullDayWindow(exception.dateLocal, args.shift.timezone);

    availableIntervals = subtractInterval(availableIntervals, blockedWindow);
  }

  const shiftWindow: UtcInterval = {
    start: toUtc(args.shift.startAtUtc),
    end: toUtc(args.shift.endAtUtc),
  };

  const available = isCoveredByIntervals(shiftWindow, availableIntervals);

  if (!available) {
    violations.push({
      code: 'AVAILABILITY_VIOLATION',
      message: 'Staff member is not available for the full shift window.',
      details: {
        shiftId: args.shift._id.toString(),
        shiftTitle: args.shift.title,
        shiftStartAtUtc: args.shift.startAtUtc,
        shiftEndAtUtc: args.shift.endAtUtc,
        timezone: args.shift.timezone,
      },
    });
  }

  return violations;
};

const fetchExistingAssignedShiftWindows = async (args: {
  staffId: Types.ObjectId;
  targetShiftId: Types.ObjectId;
  session?: ClientSession;
}): Promise<{ alreadyAssigned: boolean; existingShifts: ExistingShiftWindow[] }> => {
  const assignmentsQuery = ShiftAssignmentModel.find({
    staffId: args.staffId,
    status: 'assigned',
  }).select('shiftId');

  if (args.session) {
    assignmentsQuery.session(args.session);
  }

  const assignments = await assignmentsQuery.lean();
  const targetShiftIdStr = args.targetShiftId.toString();

  const alreadyAssigned = assignments.some(
    (assignment) => assignment.shiftId.toString() === targetShiftIdStr,
  );

  const otherShiftIds = assignments
    .map((assignment) => assignment.shiftId)
    .filter((shiftId) => shiftId.toString() !== targetShiftIdStr);

  if (otherShiftIds.length === 0) {
    return { alreadyAssigned, existingShifts: [] };
  }

  const shiftsQuery = ShiftModel.find({ _id: { $in: otherShiftIds } }).select(
    'title startAtUtc endAtUtc',
  );
  if (args.session) {
    shiftsQuery.session(args.session);
  }

  const existingShifts = await shiftsQuery.lean();

  return {
    alreadyAssigned,
    existingShifts: existingShifts.map((shift) => ({
      shiftId: shift._id.toString(),
      title: shift.title,
      startAtUtc: shift.startAtUtc,
      endAtUtc: shift.endAtUtc,
    })),
  };
};

const evaluateStaffAgainstShift = async (args: {
  staff: {
    _id: Types.ObjectId;
    firstName: string;
    lastName: string;
  };
  shift: {
    _id: Types.ObjectId;
    locationId: Types.ObjectId;
    timezone: string;
    startAtUtc: string;
    endAtUtc: string;
    title: string;
    requiredSkill?: string;
  };
  locationCode: string;
  session?: ClientSession;
}): Promise<AssignmentViolation[]> => {
  const violations: AssignmentViolation[] = [];

  const certificationQuery = StaffCertificationModel.exists({
    staffId: args.staff._id,
    locationId: args.shift.locationId,
  });
  if (args.session) {
    certificationQuery.session(args.session);
  }

  const normalizedRequiredSkill = args.shift.requiredSkill?.trim() ?? '';

  const skillQuery = StaffSkillModel.exists({
    staffId: args.staff._id,
    skill: normalizedRequiredSkill,
  });
  if (args.session) {
    skillQuery.session(args.session);
  }

  const [hasCertification, hasRequiredSkill] = await Promise.all([
    certificationQuery,
    normalizedRequiredSkill.length > 0 ? skillQuery : Promise.resolve(true),
  ]);

  if (!hasCertification) {
    violations.push({
      code: 'LOCATION_CERTIFICATION_REQUIRED',
      message: `Staff member is not certified for location ${args.locationCode}.`,
      details: {
        locationId: args.shift.locationId.toString(),
        locationCode: args.locationCode,
      },
    });
  }

  if (normalizedRequiredSkill.length > 0 && !hasRequiredSkill) {
    violations.push({
      code: 'REQUIRED_SKILL_MISSING',
      message: `Required skill \"${normalizedRequiredSkill}\" is missing.`,
      details: {
        requiredSkill: normalizedRequiredSkill,
      },
    });
  }

  const availabilityViolations = await evaluateAvailability({
    staffId: args.staff._id,
    shift: args.shift,
    session: args.session,
  });

  violations.push(...availabilityViolations);

  const temporal = await fetchExistingAssignedShiftWindows({
    staffId: args.staff._id,
    targetShiftId: args.shift._id,
    session: args.session,
  });

  if (temporal.alreadyAssigned) {
    violations.push({
      code: 'ALREADY_ASSIGNED',
      message: 'Staff member is already assigned to this shift.',
      details: {
        shiftId: args.shift._id.toString(),
      },
    });
  }

  const temporalViolations = evaluateTemporalViolations(
    {
      shiftId: args.shift._id.toString(),
      startAtUtc: args.shift.startAtUtc,
      endAtUtc: args.shift.endAtUtc,
      title: args.shift.title,
    },
    temporal.existingShifts,
  );

  violations.push(...temporalViolations);
  return violations;
};

const getSuggestions = async (args: {
  targetStaffId: Types.ObjectId;
  shift: {
    _id: Types.ObjectId;
    locationId: Types.ObjectId;
    timezone: string;
    startAtUtc: string;
    endAtUtc: string;
    title: string;
    requiredSkill?: string;
  };
  locationCode: string;
  session?: ClientSession;
}): Promise<AssignmentSuggestion[]> => {
  const staffQuery = UserModel.find({
    role: 'staff',
    active: true,
    _id: { $ne: args.targetStaffId },
  })
    .select('firstName lastName')
    .sort({ firstName: 1, lastName: 1 });

  if (args.session) {
    staffQuery.session(args.session);
  }

  const staffCandidates = await staffQuery.lean();
  const suggestions: AssignmentSuggestion[] = [];

  for (const candidate of staffCandidates) {
    const violations = await evaluateStaffAgainstShift({
      staff: {
        _id: candidate._id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      },
      shift: args.shift,
      locationCode: args.locationCode,
      session: args.session,
    });

    if (violations.length === 0) {
      const reasonParts = [
        `Certified for ${args.locationCode}`,
        args.shift.requiredSkill ? `has ${args.shift.requiredSkill}` : 'skill-compatible',
        'available for this shift',
        'no overlap/rest conflicts',
      ];

      suggestions.push({
        staffId: candidate._id.toString(),
        name: `${candidate.firstName} ${candidate.lastName}`,
        reason: reasonParts.join(', '),
      });
    }

    if (suggestions.length >= SUGGESTION_LIMIT) {
      break;
    }
  }

  return suggestions;
};

export async function validateAssignment(
  input: ValidateAssignmentInput,
): Promise<ValidateAssignmentResult> {
  if (!Types.ObjectId.isValid(input.shiftId) || !Types.ObjectId.isValid(input.staffId)) {
    return {
      ok: false,
      violations: [
        {
          code: 'INVALID_INPUT',
          message: 'Shift ID or staff ID is invalid.',
          details: {
            shiftId: input.shiftId,
            staffId: input.staffId,
          },
        },
      ],
      suggestions: [],
    };
  }

  const shiftId = new Types.ObjectId(input.shiftId);
  const staffId = new Types.ObjectId(input.staffId);

  const shiftQuery = ShiftModel.findById(shiftId).select(
    'locationId timezone startAtUtc endAtUtc title requiredSkill',
  );
  if (input.session) {
    shiftQuery.session(input.session);
  }

  const shift = await shiftQuery.lean();
  if (!shift) {
    return {
      ok: false,
      violations: [
        {
          code: 'SHIFT_NOT_FOUND',
          message: 'Shift not found.',
          details: { shiftId: input.shiftId },
        },
      ],
      suggestions: [],
    };
  }

  const locationQuery = LocationModel.findById(shift.locationId).select('code name timezone');
  if (input.session) {
    locationQuery.session(input.session);
  }

  const location = await locationQuery.lean();
  const locationCode = location?.code ?? 'UNKNOWN';

  const staffQuery = UserModel.findOne({
    _id: staffId,
    role: 'staff',
    active: true,
  }).select('firstName lastName');

  if (input.session) {
    staffQuery.session(input.session);
  }

  const staff = await staffQuery.lean();
  if (!staff) {
    return {
      ok: false,
      violations: [
        {
          code: 'STAFF_NOT_FOUND',
          message: 'Staff member not found or inactive.',
          details: { staffId: input.staffId },
        },
      ],
      suggestions: [],
    };
  }

  const violations = await evaluateStaffAgainstShift({
    staff: {
      _id: staff._id,
      firstName: staff.firstName,
      lastName: staff.lastName,
    },
    shift: {
      _id: shift._id,
      locationId: shift.locationId,
      timezone: shift.timezone,
      startAtUtc: shift.startAtUtc,
      endAtUtc: shift.endAtUtc,
      title: shift.title,
      requiredSkill: shift.requiredSkill,
    },
    locationCode,
    session: input.session,
  });

  if (violations.length === 0) {
    return { ok: true, violations: [], suggestions: [] };
  }

  const suggestions = await getSuggestions({
    targetStaffId: staff._id,
    shift: {
      _id: shift._id,
      locationId: shift.locationId,
      timezone: shift.timezone,
      startAtUtc: shift.startAtUtc,
      endAtUtc: shift.endAtUtc,
      title: shift.title,
      requiredSkill: shift.requiredSkill,
    },
    locationCode,
    session: input.session,
  });

  return {
    ok: false,
    violations,
    suggestions,
  };
}
