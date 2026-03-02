import { Types } from 'mongoose';
import { ClockEventModel, ShiftModel, UserModel } from '../models/index.js';

export type OnDutyEntry = {
  staffId: string;
  staffName: string;
  staffEmail: string;
  shiftId: string;
  shiftTitle: string;
  clockedInAtUtc: string;
  locationId: string;
  timezone: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
};

type EventRef = {
  staffId: string;
  shiftId: string;
  clockedInAtUtc: string;
};

export const getOnDutyStateForLocation = async (locationId: string): Promise<OnDutyEntry[]> => {
  if (!Types.ObjectId.isValid(locationId)) {
    return [];
  }

  const locationObjectId = new Types.ObjectId(locationId);

  const events = await ClockEventModel.find({ locationId: locationObjectId, shiftId: { $exists: true } })
    .sort({ atUtc: -1, createdAt: -1 })
    .lean();

  const lastByStaffAndShift = new Map<string, { eventType: 'clock_in' | 'clock_out'; atUtc: string }>();

  for (const event of events) {
    if (!event.shiftId) {
      continue;
    }

    const key = `${event.staffId.toString()}:${event.shiftId.toString()}`;
    if (!lastByStaffAndShift.has(key)) {
      lastByStaffAndShift.set(key, {
        eventType: event.eventType,
        atUtc: event.atUtc,
      });
    }
  }

  const onDutyRefs: EventRef[] = [];

  for (const [key, value] of lastByStaffAndShift.entries()) {
    if (value.eventType !== 'clock_in') {
      continue;
    }

    const [staffId, shiftId] = key.split(':');
    if (!staffId || !shiftId) {
      continue;
    }

    onDutyRefs.push({
      staffId,
      shiftId,
      clockedInAtUtc: value.atUtc,
    });
  }

  if (onDutyRefs.length === 0) {
    return [];
  }

  const staffIds = Array.from(new Set(onDutyRefs.map((entry) => entry.staffId))).map(
    (id) => new Types.ObjectId(id),
  );
  const shiftIds = Array.from(new Set(onDutyRefs.map((entry) => entry.shiftId))).map(
    (id) => new Types.ObjectId(id),
  );

  const [staffRows, shiftRows] = await Promise.all([
    UserModel.find({ _id: { $in: staffIds } }).select('firstName lastName email').lean(),
    ShiftModel.find({ _id: { $in: shiftIds } })
      .select('title timezone localDate startLocalTime endLocalTime locationId startAtUtc')
      .lean(),
  ]);

  const staffById = new Map(
    staffRows.map((staff) => [
      staff._id.toString(),
      {
        name: `${staff.firstName} ${staff.lastName}`,
        email: staff.email,
      },
    ]),
  );

  const shiftById = new Map(
    shiftRows.map((shift) => [
      shift._id.toString(),
      {
        shiftTitle: shift.title,
        locationId: shift.locationId.toString(),
        timezone: shift.timezone,
        localDate: shift.localDate,
        startLocalTime: shift.startLocalTime,
        endLocalTime: shift.endLocalTime,
        startAtUtc: shift.startAtUtc,
      },
    ]),
  );

  return onDutyRefs
    .map((ref) => {
      const staff = staffById.get(ref.staffId);
      const shift = shiftById.get(ref.shiftId);

      if (!staff || !shift) {
        return null;
      }

      return {
        staffId: ref.staffId,
        staffName: staff.name,
        staffEmail: staff.email,
        shiftId: ref.shiftId,
        shiftTitle: shift.shiftTitle,
        clockedInAtUtc: ref.clockedInAtUtc,
        locationId: shift.locationId,
        timezone: shift.timezone,
        localDate: shift.localDate,
        startLocalTime: shift.startLocalTime,
        endLocalTime: shift.endLocalTime,
        sortStartAtUtc: shift.startAtUtc,
      };
    })
    .filter((entry): entry is OnDutyEntry & { sortStartAtUtc: string } => Boolean(entry))
    .sort((a, b) => (a.sortStartAtUtc > b.sortStartAtUtc ? 1 : -1))
    .map((entry) => ({
      staffId: entry.staffId,
      staffName: entry.staffName,
      staffEmail: entry.staffEmail,
      shiftId: entry.shiftId,
      shiftTitle: entry.shiftTitle,
      clockedInAtUtc: entry.clockedInAtUtc,
      locationId: entry.locationId,
      timezone: entry.timezone,
      localDate: entry.localDate,
      startLocalTime: entry.startLocalTime,
      endLocalTime: entry.endLocalTime,
    }));
};
