export type UserRole = 'admin' | 'manager' | 'staff';
export type NotificationPreference = 'in_app_only' | 'in_app_plus_email_sim';

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
  notificationPreference: NotificationPreference;
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
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ListNotificationsResponse = {
  notifications: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type NotificationResponse = {
  notification: NotificationItem;
};

export type MarkNotificationsReadResponse = {
  message: string;
  modifiedCount: number;
};

export type UpdateNotificationPreferenceResponse = {
  preference: NotificationPreference;
  message: string;
};

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

export type OnDutyResponse = {
  locationId: string;
  generatedAtUtc: string;
  onDuty: OnDutyEntry[];
};

export type ClockActionResponse = {
  event: {
    _id: string;
    shiftId?: string;
    staffId: string;
    locationId: string;
    eventType: 'clock_in' | 'clock_out';
    atUtc: string;
  };
  onDutyCount: number;
  onDuty: OnDutyEntry[];
};
