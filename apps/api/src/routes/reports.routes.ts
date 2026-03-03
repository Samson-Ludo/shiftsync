import { Router } from 'express';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import {
  LocationModel,
  StaffCertificationModel,
  ShiftAssignmentModel,
  ShiftModel,
  StaffProfileModel,
  UserModel,
} from '../models/index.js';
import { canManageLocation } from '../services/access.service.js';
import { calculateShiftDurationHours } from '../services/laborCompliance.js';

const listOvertimeSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    locationId: z.string().min(1),
    weekStart: z.string().optional(),
  }),
});

const listFairnessSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    locationId: z.string().min(1),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

const roundToTwo = (value: number): number => Number(value.toFixed(2));
const clamp = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, value));

const parseObjectId = (value: string): Types.ObjectId | null => {
  if (!Types.ObjectId.isValid(value)) {
    return null;
  }
  return new Types.ObjectId(value);
};

const isPremiumShift = (args: {
  shiftLocalDate: string;
  shiftStartLocalTime: string;
  timezone: string;
}): boolean => {
  const start = DateTime.fromISO(`${args.shiftLocalDate}T${args.shiftStartLocalTime}`, {
    zone: args.timezone,
  });
  if (!start.isValid) {
    return false;
  }

  // Luxon weekday: Monday=1 ... Sunday=7
  const isFridayOrSaturday = start.weekday === 5 || start.weekday === 6;
  const minutes = start.hour * 60 + start.minute;
  const eveningStartMinutes = 17 * 60;
  const eveningEndMinutes = 23 * 60;
  const isEveningWindow = minutes >= eveningStartMinutes && minutes <= eveningEndMinutes;

  return isFridayOrSaturday && isEveningWindow;
};

const resolveManagedLocation = async (args: {
  req: AuthenticatedRequest;
  locationId: Types.ObjectId;
  forbiddenMessage: string;
}): Promise<
  | {
      ok: true;
      location: {
        _id: Types.ObjectId;
        name: string;
        code: string;
        timezone: string;
      };
    }
  | {
      ok: false;
      status: number;
      payload: Record<string, unknown>;
    }
> => {
  const user = args.req.user;
  if (!user) {
    return { ok: false, status: 401, payload: { message: 'Unauthorized' } };
  }

  const location = await LocationModel.findById(args.locationId).select('_id name code timezone').lean();
  if (!location) {
    return {
      ok: false,
      status: 404,
      payload: {
        code: 'location_not_found',
        message: 'Location not found',
      },
    };
  }

  if (user.role === 'manager') {
    const allowed = await canManageLocation(user, location._id.toString());
    if (!allowed) {
      return {
        ok: false,
        status: 403,
        payload: {
          code: 'forbidden',
          message: args.forbiddenMessage,
        },
      };
    }
  }

  return { ok: true, location };
};

export const reportsRouter = Router();

reportsRouter.get(
  '/overtime',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(listOvertimeSchema),
  async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const locationObjectId = parseObjectId(req.query.locationId as string);
    if (!locationObjectId) {
      res.status(400).json({
        code: 'invalid_location_id',
        message: 'Invalid locationId',
      });
      return;
    }

    const managedLocation = await resolveManagedLocation({
      req,
      locationId: locationObjectId,
      forbiddenMessage: 'Cannot view overtime report for this location',
    });

    if (!managedLocation.ok) {
      res.status(managedLocation.status).json(managedLocation.payload);
      return;
    }
    const location = managedLocation.location;

    const queryWeekStart = typeof req.query.weekStart === 'string' ? req.query.weekStart : undefined;
    const weekStartLocal =
      queryWeekStart ??
      (DateTime.now().setZone(location.timezone).startOf('week').toISODate() ??
        DateTime.now().setZone(location.timezone).toISODate() ??
        '');

    const shifts = await ShiftModel.find({
      locationId: location._id,
      weekStartLocal,
    })
      .select('_id title localDate startLocalTime endLocalTime startAtUtc endAtUtc')
      .lean();

    const shiftIds = shifts.map((shift) => shift._id);
    const shiftById = new Map(shifts.map((shift) => [shift._id.toString(), shift]));

    if (shiftIds.length === 0) {
      res.json({
        location,
        weekStartLocal,
        overtimePremiumFormula: 'hoursOver40 * hourlyRate * 0.5',
        staff: [],
        totals: {
          projectedOvertimePremiumCost: 0,
          staffOver40Count: 0,
        },
      });
      return;
    }

    const assignments = await ShiftAssignmentModel.find({
      shiftId: { $in: shiftIds },
      status: 'assigned',
    })
      .select('_id shiftId staffId')
      .lean();

    const staffIds = Array.from(new Set(assignments.map((assignment) => assignment.staffId.toString()))).map(
      (id) => new Types.ObjectId(id),
    );

    const [profiles, staffUsers] = await Promise.all([
      StaffProfileModel.find({ userId: { $in: staffIds } }).select('userId hourlyRate').lean(),
      UserModel.find({ _id: { $in: staffIds } }).select('_id firstName lastName').lean(),
    ]);

    const profileByStaffId = new Map(
      profiles.map((profile) => [profile.userId.toString(), profile.hourlyRate]),
    );
    const nameByStaffId = new Map(
      staffUsers.map((staffUser) => [staffUser._id.toString(), `${staffUser.firstName} ${staffUser.lastName}`]),
    );

    const assignmentsByStaff = new Map<string, typeof assignments>();

    for (const assignment of assignments) {
      const staffKey = assignment.staffId.toString();
      assignmentsByStaff.set(staffKey, [...(assignmentsByStaff.get(staffKey) ?? []), assignment]);
    }

    const staffRows = Array.from(assignmentsByStaff.entries()).map(([staffId, staffAssignments]) => {
      const orderedAssignments = [...staffAssignments].sort((left, right) => {
        const leftShift = shiftById.get(left.shiftId.toString());
        const rightShift = shiftById.get(right.shiftId.toString());

        if (!leftShift || !rightShift) {
          return 0;
        }

        if (leftShift.startAtUtc === rightShift.startAtUtc) {
          return left._id.toString().localeCompare(right._id.toString());
        }

        return leftShift.startAtUtc < rightShift.startAtUtc ? -1 : 1;
      });

      let runningHours = 0;
      const overtimeDrivers: Array<{
        assignmentId: string;
        shiftId: string;
        shiftTitle: string;
        localDate: string;
        startLocalTime: string;
        endLocalTime: string;
        assignmentHours: number;
        projectedHoursAfterAssignment: number;
        overtimeHoursFromAssignment: number;
      }> = [];

      for (const assignment of orderedAssignments) {
        const shift = shiftById.get(assignment.shiftId.toString());
        if (!shift) {
          continue;
        }

        const assignmentHours = calculateShiftDurationHours(shift.startAtUtc, shift.endAtUtc);
        const hoursBefore = runningHours;
        const hoursAfter = roundToTwo(hoursBefore + assignmentHours);

        const overtimeBefore = Math.max(0, hoursBefore - 40);
        const overtimeAfter = Math.max(0, hoursAfter - 40);
        const overtimeHoursFromAssignment = roundToTwo(overtimeAfter - overtimeBefore);

        if (overtimeHoursFromAssignment > 0) {
          overtimeDrivers.push({
            assignmentId: assignment._id.toString(),
            shiftId: shift._id.toString(),
            shiftTitle: shift.title,
            localDate: shift.localDate,
            startLocalTime: shift.startLocalTime,
            endLocalTime: shift.endLocalTime,
            assignmentHours,
            projectedHoursAfterAssignment: hoursAfter,
            overtimeHoursFromAssignment,
          });
        }

        runningHours = hoursAfter;
      }

      const hourlyRate = profileByStaffId.get(staffId) ?? 18;
      const overtimeHours = roundToTwo(Math.max(0, runningHours - 40));
      const overtimePremiumCost = roundToTwo(overtimeHours * hourlyRate * 0.5);

      return {
        staffId,
        staffName: nameByStaffId.get(staffId) ?? 'Unknown Staff',
        hourlyRate,
        totalHours: roundToTwo(runningHours),
        overtimeHours,
        overtimePremiumCost,
        overtimeDrivers,
      };
    });

    const projectedOvertimePremiumCost = roundToTwo(
      staffRows.reduce((sum, row) => sum + row.overtimePremiumCost, 0),
    );

    res.json({
      location,
      weekStartLocal,
      overtimePremiumFormula: 'hoursOver40 * hourlyRate * 0.5',
      staff: staffRows,
      totals: {
        projectedOvertimePremiumCost,
        staffOver40Count: staffRows.filter((row) => row.overtimeHours > 0).length,
      },
    });
  },
);

reportsRouter.get(
  '/fairness',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(listFairnessSchema),
  async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const locationObjectId = parseObjectId(req.query.locationId as string);
    if (!locationObjectId) {
      res.status(400).json({
        code: 'invalid_location_id',
        message: 'Invalid locationId',
      });
      return;
    }

    const managedLocation = await resolveManagedLocation({
      req,
      locationId: locationObjectId,
      forbiddenMessage: 'Cannot view fairness report for this location',
    });

    if (!managedLocation.ok) {
      res.status(managedLocation.status).json(managedLocation.payload);
      return;
    }
    const location = managedLocation.location;

    const nowInLocation = DateTime.now().setZone(location.timezone);
    const defaultStart = nowInLocation.startOf('week').toISODate() ?? nowInLocation.toISODate() ?? '';
    const defaultEnd =
      nowInLocation.startOf('week').plus({ days: 6 }).toISODate() ?? nowInLocation.toISODate() ?? '';

    const startDateRaw = typeof req.query.startDate === 'string' ? req.query.startDate : defaultStart;
    const endDateRaw = typeof req.query.endDate === 'string' ? req.query.endDate : defaultEnd;

    const startLocal = DateTime.fromISO(startDateRaw, { zone: location.timezone }).startOf('day');
    const endLocal = DateTime.fromISO(endDateRaw, { zone: location.timezone }).startOf('day');
    if (!startLocal.isValid || !endLocal.isValid || endLocal < startLocal) {
      res.status(400).json({
        code: 'invalid_date_range',
        message: 'startDate and endDate must be valid ISO dates and endDate must be on/after startDate',
      });
      return;
    }

    const endExclusiveLocal = endLocal.plus({ days: 1 });
    const startUtcIso = startLocal.toUTC().toISO();
    const endExclusiveUtcIso = endExclusiveLocal.toUTC().toISO();
    if (!startUtcIso || !endExclusiveUtcIso) {
      res.status(400).json({
        code: 'invalid_date_range',
        message: 'Could not resolve date range boundaries',
      });
      return;
    }

    const shifts = await ShiftModel.find({
      locationId: location._id,
      startAtUtc: {
        $gte: startUtcIso,
        $lt: endExclusiveUtcIso,
      },
    })
      .select('_id title localDate startLocalTime endLocalTime startAtUtc endAtUtc timezone')
      .lean();

    const shiftById = new Map(shifts.map((shift) => [shift._id.toString(), shift]));
    const shiftIds = shifts.map((shift) => shift._id);

    const assignments = shiftIds.length
      ? await ShiftAssignmentModel.find({
          shiftId: { $in: shiftIds },
          status: 'assigned',
        })
          .select('_id shiftId staffId')
          .lean()
      : [];

    const certifiedStaffRows = await StaffCertificationModel.find({
      locationId: location._id,
    })
      .select('staffId')
      .lean();

    const certifiedStaffIds = Array.from(new Set(certifiedStaffRows.map((row) => row.staffId.toString()))).map(
      (id) => new Types.ObjectId(id),
    );

    const [staffUsers, profiles] = await Promise.all([
      UserModel.find({
        _id: { $in: certifiedStaffIds },
        role: 'staff',
        active: true,
      })
        .select('_id firstName lastName')
        .sort({ firstName: 1, lastName: 1 })
        .lean(),
      StaffProfileModel.find({
        userId: { $in: certifiedStaffIds },
      })
        .select('userId desiredWeeklyHours maxHoursPerWeek')
        .lean(),
    ]);

    const profileByStaffId = new Map(
      profiles.map((profile) => [
        profile.userId.toString(),
        {
          desiredWeeklyHours:
            typeof profile.desiredWeeklyHours === 'number'
              ? profile.desiredWeeklyHours
              : profile.maxHoursPerWeek ?? 40,
        },
      ]),
    );

    const assignmentsByStaff = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const staffId = assignment.staffId.toString();
      assignmentsByStaff.set(staffId, [...(assignmentsByStaff.get(staffId) ?? []), assignment]);
    }

    const periodDays = Math.max(1, endExclusiveLocal.diff(startLocal, 'days').days);
    const periodWeeks = periodDays / 7;

    const preliminaryRows = staffUsers.map((staffUser) => {
      const staffId = staffUser._id.toString();
      const staffAssignments = assignmentsByStaff.get(staffId) ?? [];

      let assignedHours = 0;
      let premiumShiftCount = 0;

      for (const assignment of staffAssignments) {
        const shift = shiftById.get(assignment.shiftId.toString());
        if (!shift) {
          continue;
        }

        assignedHours += calculateShiftDurationHours(shift.startAtUtc, shift.endAtUtc);
        if (
          isPremiumShift({
            shiftLocalDate: shift.localDate,
            shiftStartLocalTime: shift.startLocalTime,
            timezone: shift.timezone,
          })
        ) {
          premiumShiftCount += 1;
        }
      }

      const desiredWeeklyHours = profileByStaffId.get(staffId)?.desiredWeeklyHours ?? 40;
      const desiredHoursForPeriod = roundToTwo(desiredWeeklyHours * periodWeeks);
      const roundedAssignedHours = roundToTwo(assignedHours);
      const deltaHours = roundToTwo(roundedAssignedHours - desiredHoursForPeriod);

      return {
        staffId,
        staffName: `${staffUser.firstName} ${staffUser.lastName}`,
        desiredWeeklyHours,
        desiredHoursForPeriod,
        assignedHours: roundedAssignedHours,
        deltaHours,
        premiumShiftCount,
      };
    });

    const totalPremiumShifts = preliminaryRows.reduce((sum, row) => sum + row.premiumShiftCount, 0);
    const premiumTargetPerStaff =
      preliminaryRows.length > 0 ? roundToTwo(totalPremiumShifts / preliminaryRows.length) : 0;

    const scoredRows = preliminaryRows.map((row) => {
      const premiumDeviation = Math.abs(row.premiumShiftCount - premiumTargetPerStaff);
      const premiumDenominator = premiumTargetPerStaff > 0 ? premiumTargetPerStaff : 1;
      const premiumBalanceScore = clamp(100 - (premiumDeviation / premiumDenominator) * 100);

      let hoursBalanceScore = 100;
      if (row.desiredHoursForPeriod <= 0) {
        hoursBalanceScore = row.assignedHours <= 0 ? 100 : 0;
      } else {
        hoursBalanceScore = clamp(
          100 - (Math.abs(row.deltaHours) / Math.max(1, row.desiredHoursForPeriod)) * 100,
        );
      }

      const fairnessScore = roundToTwo(premiumBalanceScore * 0.6 + hoursBalanceScore * 0.4);

      return {
        ...row,
        premiumBalanceScore: roundToTwo(premiumBalanceScore),
        hoursBalanceScore: roundToTwo(hoursBalanceScore),
        fairnessScore,
        scheduleBalance:
          row.deltaHours > 0.5 ? 'over_scheduled' : row.deltaHours < -0.5 ? 'under_scheduled' : 'balanced',
      };
    });

    const overallFairnessScore =
      scoredRows.length > 0
        ? roundToTwo(scoredRows.reduce((sum, row) => sum + row.fairnessScore, 0) / scoredRows.length)
        : 100;

    const totalAssignedHours = roundToTwo(scoredRows.reduce((sum, row) => sum + row.assignedHours, 0));

    res.json({
      location,
      period: {
        startDate: startLocal.toISODate(),
        endDate: endLocal.toISODate(),
        timezone: location.timezone,
        days: periodDays,
      },
      premiumDefinition:
        'Premium shift = Friday or Saturday shift with start time between 17:00 and 23:00 (inclusive) in location timezone.',
      fairnessScoring: {
        perStaffFormula:
          'fairnessScore = 0.6 * premiumBalanceScore + 0.4 * hoursBalanceScore; each sub-score is clamped 0-100.',
        premiumBalanceScore:
          '100 - ((abs(staffPremium - premiumTargetPerStaff) / max(1, premiumTargetPerStaff)) * 100)',
        hoursBalanceScore:
          '100 - ((abs(assignedHours - desiredHoursForPeriod) / max(1, desiredHoursForPeriod)) * 100)',
      },
      overall: {
        staffCount: scoredRows.length,
        totalAssignedHours,
        totalPremiumShifts,
        premiumTargetPerStaff,
        overallFairnessScore,
      },
      staff: scoredRows,
    });
  },
);
