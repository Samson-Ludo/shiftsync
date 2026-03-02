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

export type AuthLoginResponse = {
  token: string;
  user: CurrentUser;
};

export type MeResponse = {
  user: CurrentUser;
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
  requiredSkill?: string;
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

export type ListShiftsResponse = {
  shifts: ShiftItem[];
};

export type CreateShiftRequest = {
  locationId: string;
  title: string;
  requiredSkill?: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
};

export type UpdateShiftRequest = Partial<Omit<CreateShiftRequest, 'locationId'>>;

export type ShiftMutationResponse = {
  shift: ShiftItem;
};

export type PublishShiftResponse = {
  message: string;
  weekStartLocal: string;
  modifiedCount: number;
};

export type AssignmentViolation = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type AssignmentSuggestion = {
  staffId: string;
  name: string;
  reason: string;
};

export type AssignmentValidationResponse = {
  ok: boolean;
  violations: AssignmentViolation[];
  suggestions: AssignmentSuggestion[];
};

export type AssignStaffRequest = {
  staffId: string;
  overrideReason?: string;
};

export type AssignStaffResponse = {
  assignment: {
    _id: string;
    shiftId: string;
    staffId: string;
    assignedBy: string;
    status: string;
  };
  validation: AssignmentValidationResponse;
};

export type StaffOption = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  skills: string[];
  certifiedLocationIds: string[];
  isCertifiedForLocation: boolean | null;
};

export type ListStaffResponse = {
  staff: StaffOption[];
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

export type ListNotificationsResponse = {
  notifications: NotificationItem[];
};

export type NotificationResponse = {
  notification: NotificationItem;
};