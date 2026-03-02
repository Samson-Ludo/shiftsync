import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from './db/mongoose.js';
import {
  AuditLogModel,
  AvailabilityExceptionModel,
  AvailabilityRuleModel,
  ClockEventModel,
  LocationModel,
  LockModel,
  ManagerLocationModel,
  NotificationModel,
  ShiftAssignmentModel,
  ShiftModel,
  StaffCertificationModel,
  StaffProfileModel,
  StaffSkillModel,
  SwapRequestModel,
  UserModel,
} from './models/index.js';
import { computeWeekStart, resolveShiftUtcWindow } from './utils/time.js';

const DEFAULT_PASSWORD = 'Pass123!';

type StaffSeed = {
  firstName: string;
  lastName: string;
  email: string;
  maxHoursPerWeek: number;
  certifications: string[];
  skills: string[];
};

type ShiftInsert = {
  locationId: Types.ObjectId;
  title: string;
  requiredSkill?: string;
  timezone: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  startAtUtc: string;
  endAtUtc: string;
  overnight: boolean;
  weekStartLocal: string;
  published: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
};

const staffSeedData: StaffSeed[] = [
  {
    firstName: 'Ava',
    lastName: 'Ramirez',
    email: 'ava.staff@coastaleats.com',
    maxHoursPerWeek: 40,
    certifications: ['NYC_MID', 'NYC_BRK'],
    skills: ['line_cook', 'closing'],
  },
  {
    firstName: 'Noah',
    lastName: 'Kim',
    email: 'noah.staff@coastaleats.com',
    maxHoursPerWeek: 35,
    certifications: ['LA_PIER'],
    skills: ['cashier', 'opening'],
  },
  {
    firstName: 'Mia',
    lastName: 'Patel',
    email: 'mia.staff@coastaleats.com',
    maxHoursPerWeek: 32,
    certifications: ['LA_DT', 'LA_PIER'],
    skills: ['barista', 'server'],
  },
  {
    firstName: 'Ethan',
    lastName: 'Lopez',
    email: 'ethan.staff@coastaleats.com',
    maxHoursPerWeek: 38,
    certifications: ['NYC_MID'],
    skills: ['prep', 'line_cook'],
  },
  {
    firstName: 'Olivia',
    lastName: 'Chen',
    email: 'olivia.staff@coastaleats.com',
    maxHoursPerWeek: 30,
    certifications: ['NYC_BRK'],
    skills: ['host', 'server'],
  },
  {
    firstName: 'Liam',
    lastName: 'Wright',
    email: 'liam.staff@coastaleats.com',
    maxHoursPerWeek: 36,
    certifications: ['LA_DT'],
    skills: ['line_cook', 'prep'],
  },
  {
    firstName: 'Sophia',
    lastName: 'Garcia',
    email: 'sophia.staff@coastaleats.com',
    maxHoursPerWeek: 34,
    certifications: ['NYC_MID', 'LA_DT'],
    skills: ['cashier', 'expo'],
  },
  {
    firstName: 'Mason',
    lastName: 'Reed',
    email: 'mason.staff@coastaleats.com',
    maxHoursPerWeek: 40,
    certifications: ['LA_PIER', 'LA_DT'],
    skills: ['closing', 'dish'],
  },
  {
    firstName: 'Isabella',
    lastName: 'Scott',
    email: 'isabella.staff@coastaleats.com',
    maxHoursPerWeek: 28,
    certifications: ['NYC_BRK', 'NYC_MID'],
    skills: ['server', 'barista'],
  },
  {
    firstName: 'James',
    lastName: 'Torres',
    email: 'james.staff@coastaleats.com',
    maxHoursPerWeek: 40,
    certifications: ['LA_PIER'],
    skills: ['prep', 'opening'],
  },
  {
    firstName: 'Charlotte',
    lastName: 'Hill',
    email: 'charlotte.staff@coastaleats.com',
    maxHoursPerWeek: 26,
    certifications: ['NYC_BRK'],
    skills: ['host', 'cashier'],
  },
  {
    firstName: 'Benjamin',
    lastName: 'Price',
    email: 'benjamin.staff@coastaleats.com',
    maxHoursPerWeek: 37,
    certifications: ['LA_DT', 'NYC_MID'],
    skills: ['line_cook', 'expo'],
  },
];

const locationSeed = [
  {
    name: 'Coastal Eats Santa Monica Pier',
    code: 'LA_PIER',
    timezone: 'America/Los_Angeles',
    address: '200 Santa Monica Pier, Santa Monica, CA',
  },
  {
    name: 'Coastal Eats Downtown LA',
    code: 'LA_DT',
    timezone: 'America/Los_Angeles',
    address: '110 S Spring St, Los Angeles, CA',
  },
  {
    name: 'Coastal Eats Midtown Manhattan',
    code: 'NYC_MID',
    timezone: 'America/New_York',
    address: '6 W 45th St, New York, NY',
  },
  {
    name: 'Coastal Eats Brooklyn Heights',
    code: 'NYC_BRK',
    timezone: 'America/New_York',
    address: '80 Montague St, Brooklyn, NY',
  },
];

const managerSeed = [
  {
    firstName: 'Maya',
    lastName: 'Johnson',
    email: 'maya.manager@coastaleats.com',
    locations: ['LA_PIER', 'LA_DT'],
  },
  {
    firstName: 'Victor',
    lastName: 'Nguyen',
    email: 'victor.manager@coastaleats.com',
    locations: ['NYC_MID'],
  },
  {
    firstName: 'Riley',
    lastName: 'Davis',
    email: 'riley.manager@coastaleats.com',
    locations: ['NYC_BRK'],
  },
];

const makeWeekDates = (weekStartIso: string, timezone: string): string[] => {
  return Array.from({ length: 7 }).map((_, index) =>
    DateTime.fromISO(weekStartIso, { zone: timezone }).plus({ days: index }).toISODate() ?? weekStartIso,
  );
};

const seed = async () => {
  await connectToDatabase();

  await Promise.all([
    AuditLogModel.deleteMany({}),
    AvailabilityExceptionModel.deleteMany({}),
    AvailabilityRuleModel.deleteMany({}),
    ClockEventModel.deleteMany({}),
    LocationModel.deleteMany({}),
    LockModel.deleteMany({}),
    ManagerLocationModel.deleteMany({}),
    NotificationModel.deleteMany({}),
    ShiftAssignmentModel.deleteMany({}),
    ShiftModel.deleteMany({}),
    StaffCertificationModel.deleteMany({}),
    StaffProfileModel.deleteMany({}),
    StaffSkillModel.deleteMany({}),
    SwapRequestModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const locations = await LocationModel.insertMany(locationSeed);
  const locationByCode = new Map(locations.map((location) => [location.code, location]));

  const admin = await UserModel.create({
    firstName: 'Coastal',
    lastName: 'Admin',
    email: 'admin@coastaleats.com',
    passwordHash,
    role: 'admin',
    notificationPreference: 'in_app_plus_email_sim',
    active: true,
  });

  const managers = await UserModel.insertMany(
    managerSeed.map((manager, index) => ({
      firstName: manager.firstName,
      lastName: manager.lastName,
      email: manager.email,
      passwordHash,
      role: 'manager',
      notificationPreference: index === 0 ? 'in_app_plus_email_sim' : 'in_app_only',
      active: true,
    })),
  );

  await ManagerLocationModel.insertMany(
    managerSeed.flatMap((manager, index) =>
      manager.locations.map((locationCode) => ({
        managerId: managers[index]._id,
        locationId: locationByCode.get(locationCode)!._id,
      })),
    ),
  );

  const staffUsers = await UserModel.insertMany(
    staffSeedData.map((staff, index) => ({
      firstName: staff.firstName,
      lastName: staff.lastName,
      email: staff.email,
      passwordHash,
      role: 'staff',
      notificationPreference: index % 3 === 0 ? 'in_app_plus_email_sim' : 'in_app_only',
      active: true,
    })),
  );

  await StaffProfileModel.insertMany(
    staffUsers.map((user, index) => ({
      userId: user._id,
      maxHoursPerWeek: staffSeedData[index].maxHoursPerWeek,
      notes: `Primary skills: ${staffSeedData[index].skills.join(', ')}`,
    })),
  );

  await StaffSkillModel.insertMany(
    staffUsers.flatMap((user, index) =>
      staffSeedData[index].skills.map((skill) => ({
        staffId: user._id,
        skill,
        level: 'intermediate',
      })),
    ),
  );

  await StaffCertificationModel.insertMany(
    staffUsers.flatMap((user, index) =>
      staffSeedData[index].certifications.map((locationCode) => ({
        staffId: user._id,
        locationId: locationByCode.get(locationCode)!._id,
        certification: 'general-floor',
      })),
    ),
  );

  await AvailabilityRuleModel.insertMany(
    staffUsers.flatMap((user, index) => {
      const homeLocation = locationByCode.get(staffSeedData[index].certifications[0])!;
      return [
        {
          staffId: user._id,
          locationId: homeLocation._id,
          dayOfWeek: 1,
          startLocalTime: '09:00',
          endLocalTime: '17:00',
          timezone: homeLocation.timezone,
        },
        {
          staffId: user._id,
          locationId: homeLocation._id,
          dayOfWeek: 5,
          startLocalTime: '14:00',
          endLocalTime: '22:00',
          timezone: homeLocation.timezone,
        },
      ];
    }),
  );

  const weekStartLA =
    DateTime.now().setZone('America/Los_Angeles').plus({ weeks: 1 }).startOf('week').toISODate() ??
    DateTime.now().setZone('America/Los_Angeles').toISODate()!;
  const weekStartNY =
    DateTime.now().setZone('America/New_York').plus({ weeks: 1 }).startOf('week').toISODate() ??
    DateTime.now().setZone('America/New_York').toISODate()!;

  const laDates = makeWeekDates(weekStartLA, 'America/Los_Angeles');
  const nyDates = makeWeekDates(weekStartNY, 'America/New_York');

  await AvailabilityExceptionModel.insertMany([
    {
      staffId: staffUsers[0]._id,
      dateLocal: nyDates[2],
      timezone: 'America/New_York',
      type: 'block',
      reason: 'Medical appointment',
    },
    {
      staffId: staffUsers[1]._id,
      dateLocal: laDates[3],
      timezone: 'America/Los_Angeles',
      type: 'allow',
      startLocalTime: '18:00',
      endLocalTime: '22:00',
      reason: 'Can take extra evening shift',
    },
    {
      staffId: staffUsers[6]._id,
      dateLocal: nyDates[4],
      timezone: 'America/New_York',
      type: 'block',
      startLocalTime: '09:00',
      endLocalTime: '18:00',
      reason: 'Family event',
    },
    {
      staffId: staffUsers[9]._id,
      dateLocal: laDates[1],
      timezone: 'America/Los_Angeles',
      type: 'block',
      reason: 'Training day',
    },
  ]);

  const shiftRows: ShiftInsert[] = [];

  const addShift = (args: {
    locationCode: string;
    title: string;
    requiredSkill?: string;
    localDate: string;
    startLocalTime: string;
    endLocalTime: string;
    published?: boolean;
  }) => {
    const location = locationByCode.get(args.locationCode)!;
    const utcWindow = resolveShiftUtcWindow({
      localDate: args.localDate,
      startLocalTime: args.startLocalTime,
      endLocalTime: args.endLocalTime,
      timezone: location.timezone,
    });

    shiftRows.push({
      locationId: location._id,
      title: args.title,
      requiredSkill: args.requiredSkill,
      timezone: location.timezone,
      localDate: args.localDate,
      startLocalTime: args.startLocalTime,
      endLocalTime: args.endLocalTime,
      startAtUtc: utcWindow.startAtUtc,
      endAtUtc: utcWindow.endAtUtc,
      overnight: utcWindow.overnight,
      weekStartLocal: computeWeekStart(args.localDate, location.timezone),
      published: args.published ?? true,
      createdBy: admin._id,
      updatedBy: admin._id,
    });
  };

  for (let i = 0; i < 5; i += 1) {
    addShift({
      locationCode: 'LA_PIER',
      title: 'Lunch Service',
      requiredSkill: 'line_cook',
      localDate: laDates[i],
      startLocalTime: '11:00',
      endLocalTime: '15:00',
      published: true,
    });
    addShift({
      locationCode: 'LA_DT',
      title: 'Dinner Service',
      requiredSkill: 'server',
      localDate: laDates[i],
      startLocalTime: '17:00',
      endLocalTime: '21:00',
      published: false,
    });
    addShift({
      locationCode: 'NYC_MID',
      title: 'Brunch Rush',
      requiredSkill: 'barista',
      localDate: nyDates[i],
      startLocalTime: '10:00',
      endLocalTime: '14:00',
      published: true,
    });
    addShift({
      locationCode: 'NYC_BRK',
      title: 'Evening Close',
      requiredSkill: 'closing',
      localDate: nyDates[i],
      startLocalTime: '19:00',
      endLocalTime: '23:00',
      published: true,
    });
  }

  addShift({
    locationCode: 'NYC_BRK',
    title: 'Overnight Cleanup',
    requiredSkill: 'closing',
    localDate: nyDates[5],
    startLocalTime: '23:00',
    endLocalTime: '03:00',
    published: true,
  });

  addShift({
    locationCode: 'LA_PIER',
    title: 'Conflict Candidate A',
    requiredSkill: 'line_cook',
    localDate: laDates[2],
    startLocalTime: '12:00',
    endLocalTime: '16:00',
    published: true,
  });

  addShift({
    locationCode: 'LA_DT',
    title: 'Conflict Candidate B',
    requiredSkill: 'line_cook',
    localDate: laDates[2],
    startLocalTime: '13:00',
    endLocalTime: '17:00',
    published: true,
  });

  addShift({
    locationCode: 'NYC_MID',
    title: 'Unavailable Test Shift',
    requiredSkill: 'line_cook',
    localDate: nyDates[2],
    startLocalTime: '12:00',
    endLocalTime: '16:00',
    published: true,
  });

  addShift({
    locationCode: 'NYC_BRK',
    title: 'Rest Gap Test Shift',
    requiredSkill: 'server',
    localDate: nyDates[6],
    startLocalTime: '09:00',
    endLocalTime: '13:00',
    published: true,
  });

  addShift({
    locationCode: 'LA_DT',
    title: 'Uncertified Test Shift',
    requiredSkill: 'prep',
    localDate: laDates[3],
    startLocalTime: '11:00',
    endLocalTime: '15:00',
    published: true,
  });

  const highRiskShiftSpecs = [
    { day: 0, start: '06:00', end: '10:00' },
    { day: 0, start: '11:00', end: '15:00' },
    { day: 1, start: '06:00', end: '10:00' },
    { day: 1, start: '11:00', end: '15:00' },
    { day: 2, start: '06:00', end: '10:00' },
    { day: 2, start: '11:00', end: '15:00' },
    { day: 3, start: '06:00', end: '10:00' },
    { day: 3, start: '11:00', end: '15:00' },
    { day: 4, start: '06:00', end: '10:00' },
    { day: 4, start: '11:00', end: '15:00' },
    { day: 5, start: '06:00', end: '10:00' },
    { day: 5, start: '11:00', end: '15:00' },
    { day: 6, start: '06:00', end: '10:00' },
  ];

  highRiskShiftSpecs.forEach((spec, index) => {
    addShift({
      locationCode: 'NYC_MID',
      title: `High-Hours Prep Block ${index + 1}`,
      requiredSkill: 'prep',
      localDate: nyDates[spec.day],
      startLocalTime: spec.start,
      endLocalTime: spec.end,
      published: false,
    });
  });

  const shifts = await ShiftModel.insertMany(shiftRows);

  const highHoursShifts = shifts
    .filter((shift) => shift.title.startsWith('High-Hours Prep Block'))
    .sort((a, b) => (a.startAtUtc > b.startAtUtc ? 1 : -1));

  const assignments = [
    ...highHoursShifts.slice(0, 12).map((shift) => ({
      shiftId: shift._id,
      staffId: staffUsers[0]._id,
      assignedBy: managers[1]._id,
      status: 'assigned' as const,
    })),
    {
      shiftId: shifts.find((shift) => shift.title === 'Overnight Cleanup')!._id,
      staffId: staffUsers[8]._id,
      assignedBy: managers[2]._id,
      status: 'assigned' as const,
    },
    {
      shiftId: shifts.find((shift) => shift.title === 'Lunch Service')!._id,
      staffId: staffUsers[9]._id,
      assignedBy: managers[0]._id,
      status: 'assigned' as const,
    },
    {
      shiftId: shifts.find((shift) => shift.title === 'Conflict Candidate A')!._id,
      staffId: staffUsers[7]._id,
      assignedBy: managers[0]._id,
      status: 'assigned' as const,
    },
  ];

  await ShiftAssignmentModel.insertMany(assignments);

  await SwapRequestModel.create({
    shiftId: assignments[0].shiftId,
    fromStaffId: staffUsers[0]._id,
    toStaffId: staffUsers[3]._id,
    status: 'pending',
    note: 'Need coverage for appointment',
  });

  await NotificationModel.insertMany([
    {
      userId: staffUsers[0]._id,
      type: 'warning',
      title: 'Near weekly hour cap',
      body: 'You are currently assigned 48 hours this week. Another 4-hour shift would move you to 52.',
      read: false,
      metadata: { projectedHoursIfExtraShift: 52 },
    },
    {
      userId: managers[0]._id,
      type: 'conflict',
      title: 'Potential double booking detected',
      body: 'Conflict Candidate A and B overlap. Assign carefully for staff with dual LA certifications.',
      read: false,
      metadata: { shiftTitles: ['Conflict Candidate A', 'Conflict Candidate B'] },
    },
    {
      userId: staffUsers[8]._id,
      type: 'assignment',
      title: 'Overnight shift assigned',
      body: 'You are assigned to Overnight Cleanup (11:00 PM - 3:00 AM).',
      read: true,
      metadata: {},
    },
  ]);

  await AuditLogModel.create({
    actorUserId: admin._id,
    action: 'seed_database',
    entityType: 'system',
    entityId: 'seed-v1',
    payload: {
      locations: locations.length,
      managers: managers.length,
      staff: staffUsers.length,
      weekStartLA,
      weekStartNY,
    },
  });

  const nowUtcIso = DateTime.utc().toISO({ suppressMilliseconds: true }) ?? new Date().toISOString();

  await ClockEventModel.create({
    staffId: staffUsers[8]._id,
    locationId: locationByCode.get('NYC_BRK')!._id,
    eventType: 'clock_in',
    atUtc: nowUtcIso,
  });

  await LockModel.create({
    key: 'seed:example:lock',
    owner: 'seed-script',
    expiresAtUtc: DateTime.utc().plus({ minutes: 30 }).toJSDate(),
  });

  console.log('Seed complete.');
  console.log('Credentials:');
  console.log(`Admin: admin@coastaleats.com / ${DEFAULT_PASSWORD}`);
  console.log(`Manager: maya.manager@coastaleats.com / ${DEFAULT_PASSWORD}`);
  console.log(`Staff: ava.staff@coastaleats.com / ${DEFAULT_PASSWORD}`);
  console.log('Data facts:');
  console.log('- 4 locations across America/Los_Angeles and America/New_York');
  console.log('- 3 managers with explicit location assignments');
  console.log('- 12 staff with mixed skills/certifications');
  console.log('- recurring availability rules + 4 one-off exceptions');
  console.log('- overnight shift seeded: Overnight Cleanup 23:00-03:00');
  console.log('- 12x4h assignments + 1 extra 4h shift create a 52h risk scenario');
  console.log('- overlapping conflict candidate shifts exist in LA for double-booking checks');
  console.log('- explicit validation demo shifts seeded for unavailable, skill, certification, overlap, and rest constraints');

  await disconnectFromDatabase();
};

seed().catch(async (error) => {
  console.error('Seed failed', error);
  await disconnectFromDatabase();
  process.exit(1);
});
