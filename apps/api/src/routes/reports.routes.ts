import { Router } from 'express';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import {
  LocationModel,
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

const roundToTwo = (value: number): number => Number(value.toFixed(2));

const parseObjectId = (value: string): Types.ObjectId | null => {
  if (!Types.ObjectId.isValid(value)) {
    return null;
  }
  return new Types.ObjectId(value);
};

export const reportsRouter = Router();

reportsRouter.get(
  '/overtime',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(listOvertimeSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
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

    const location = await LocationModel.findById(locationObjectId).select('_id name code timezone').lean();
    if (!location) {
      res.status(404).json({
        code: 'location_not_found',
        message: 'Location not found',
      });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, location._id.toString());
      if (!allowed) {
        res.status(403).json({
          code: 'forbidden',
          message: 'Cannot view overtime report for this location',
        });
        return;
      }
    }

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
