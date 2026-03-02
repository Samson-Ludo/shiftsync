export type UserRole = 'admin' | 'manager' | 'staff';

export type LocationSummary = {
  _id: string;
  name: string;
  code: string;
  timezone: string;
};

export type CertifiedLocation = {
  location: LocationSummary;
  certification: string;
};

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  managerLocations?: LocationSummary[];
  certifiedLocations?: CertifiedLocation[];
};

export type ShiftAssignment = {
  _id: string;
  shiftId: string;
  staffId: { _id: string; firstName: string; lastName: string; email: string } | string;
  assignedBy: string;
  status: string;
};

export type ShiftItem = {
  _id: string;
  title: string;
  timezone: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  startAtUtc: string;
  endAtUtc: string;
  startAtLocal: string;
  endAtLocal: string;
  weekStartLocal: string;
  published: boolean;
  locationId: LocationSummary | string;
  assignments: ShiftAssignment[];
};

export type NotificationItem = {
  _id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};