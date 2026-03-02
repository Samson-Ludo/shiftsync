import { api } from './client';
import {
  AssignStaffRequest,
  AssignStaffResponse,
  AssignmentValidationResponse,
  AuthLoginResponse,
  CreateShiftRequest,
  CurrentUser,
  ClockActionResponse,
  ListNotificationsResponse,
  MarkNotificationsReadResponse,
  NotificationPreference,
  ListShiftsResponse,
  ListStaffResponse,
  LocationSummary,
  MeResponse,
  NotificationResponse,
  OnDutyResponse,
  PublishShiftResponse,
  ShiftMutationResponse,
  UpdateNotificationPreferenceResponse,
  UpdateShiftRequest,
} from './types';

export * from './types';
export { ApiError } from './errors';

export const login = async (email: string, password: string): Promise<AuthLoginResponse> => {
  const { data } = await api.post<AuthLoginResponse>('/auth/login', { email, password });
  return data;
};

export const me = async (): Promise<CurrentUser> => {
  const { data } = await api.get<MeResponse>('/auth/me');
  return data.user;
};

export const listLocations = async (): Promise<LocationSummary[]> => {
  const user = await me();

  if (user.role === 'staff') {
    return (user.certifiedLocations ?? []).map((entry) => entry.location);
  }

  return user.managerLocations ?? [];
};

export const listShifts = async (
  locationId?: string,
  weekStart?: string,
): Promise<ListShiftsResponse> => {
  const { data } = await api.get<ListShiftsResponse>('/shifts', {
    params: {
      ...(locationId ? { locationId } : {}),
      ...(weekStart ? { weekStart } : {}),
    },
  });

  return data;
};

export const createShift = async (payload: CreateShiftRequest): Promise<ShiftMutationResponse> => {
  const { data } = await api.post<ShiftMutationResponse>('/shifts', payload);
  return data;
};

export const updateShift = async (
  id: string,
  payload: UpdateShiftRequest,
): Promise<ShiftMutationResponse> => {
  const { data } = await api.patch<ShiftMutationResponse>(`/shifts/${id}`, payload);
  return data;
};

export const publishShift = async (id: string): Promise<PublishShiftResponse> => {
  const { data } = await api.post<PublishShiftResponse>(`/shifts/${id}/publish`);
  return data;
};

export const unpublishShift = async (id: string): Promise<ShiftMutationResponse> => {
  const { data } = await api.post<ShiftMutationResponse>(`/shifts/${id}/unpublish`);
  return data;
};

export const validateAssign = async (
  shiftId: string,
  staffId: string,
): Promise<AssignmentValidationResponse> => {
  const { data } = await api.post<AssignmentValidationResponse>(
    `/shifts/${shiftId}/validate-assign/${staffId}`,
  );
  return data;
};

export const assignStaff = async (
  shiftId: string,
  staffId: string,
  optionalOverridePayload?: Omit<AssignStaffRequest, 'staffId'>,
): Promise<AssignStaffResponse> => {
  const { data } = await api.post<AssignStaffResponse>(`/shifts/${shiftId}/assign`, {
    staffId,
    ...(optionalOverridePayload ?? {}),
  });
  return data;
};

export const unassignStaff = async (
  shiftId: string,
  assignmentId: string,
): Promise<{ message: string }> => {
  const { data } = await api.delete<{ message: string }>(
    `/shifts/${shiftId}/assignments/${assignmentId}`,
  );
  return data;
};

export const listStaff = async (locationId: string): Promise<ListStaffResponse> => {
  const { data } = await api.get<ListStaffResponse>('/staff', {
    params: { locationId },
  });
  return data;
};

export const listNotifications = async (
  page = 1,
  pageSize = 20,
): Promise<ListNotificationsResponse> => {
  const { data } = await api.get<ListNotificationsResponse>('/notifications', {
    params: { page, pageSize },
  });
  return data;
};

export const markNotificationRead = async (id: string): Promise<NotificationResponse> => {
  const { data } = await api.patch<NotificationResponse>(`/notifications/${id}/read`, {});
  return data;
};

export const markNotificationsRead = async (
  notificationIds: string[],
): Promise<MarkNotificationsReadResponse> => {
  const { data } = await api.post<MarkNotificationsReadResponse>('/notifications/mark-read', {
    notificationIds,
  });
  return data;
};

export const updateNotificationPreference = async (
  preference: NotificationPreference,
): Promise<UpdateNotificationPreferenceResponse> => {
  const { data } = await api.patch<UpdateNotificationPreferenceResponse>(
    '/users/me/notification-preferences',
    { preference },
  );
  return data;
};

export const getOnDuty = async (locationId: string): Promise<OnDutyResponse> => {
  const { data } = await api.get<OnDutyResponse>('/on-duty', { params: { locationId } });
  return data;
};

export const clockIn = async (
  shiftId: string,
  staffId?: string,
): Promise<ClockActionResponse> => {
  const { data } = await api.post<ClockActionResponse>(`/shifts/${shiftId}/clock-in`, {
    ...(staffId ? { staffId } : {}),
  });
  return data;
};

export const clockOut = async (
  shiftId: string,
  staffId?: string,
): Promise<ClockActionResponse> => {
  const { data } = await api.post<ClockActionResponse>(`/shifts/${shiftId}/clock-out`, {
    ...(staffId ? { staffId } : {}),
  });
  return data;
};
