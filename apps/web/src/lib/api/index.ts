import { api } from './client';
import {
  AssignStaffRequest,
  AssignStaffResponse,
  AssignmentValidationResponse,
  AuthLoginResponse,
  CreateSwapRequestPayload,
  CreateShiftRequest,
  CurrentUser,
  ClockActionResponse,
  AuditExportResponse,
  EligibleSwapStaffResponse,
  ListNotificationsResponse,
  ListSwapRequestsResponse,
  MarkNotificationsReadResponse,
  NotificationPreference,
  ListShiftsResponse,
  ListStaffResponse,
  LocationSummary,
  MeResponse,
  NotificationResponse,
  OnDutyResponse,
  FairnessReportResponse,
  OvertimeReportResponse,
  PublishShiftResponse,
  ShiftMutationResponse,
  ShiftAuditResponse,
  SwapRequestResponse,
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

export const listSwapRequests = async (params?: {
  mine?: boolean;
  available?: boolean;
  managerInbox?: boolean;
}): Promise<ListSwapRequestsResponse> => {
  const { data } = await api.get<ListSwapRequestsResponse>('/swap-requests', {
    params: {
      ...(params?.mine !== undefined ? { mine: params.mine } : {}),
      ...(params?.available !== undefined ? { available: params.available } : {}),
      ...(params?.managerInbox !== undefined ? { managerInbox: params.managerInbox } : {}),
    },
  });
  return data;
};

export const listEligibleSwapStaff = async (
  shiftId: string,
): Promise<EligibleSwapStaffResponse> => {
  const { data } = await api.get<EligibleSwapStaffResponse>('/swap-requests/eligible-staff', {
    params: { shiftId },
  });
  return data;
};

export const createSwapRequest = async (
  payload: CreateSwapRequestPayload,
): Promise<SwapRequestResponse> => {
  const { data } = await api.post<SwapRequestResponse>('/swap-requests', payload);
  return data;
};

export const acceptSwapRequest = async (id: string): Promise<SwapRequestResponse> => {
  const { data } = await api.post<SwapRequestResponse>(`/swap-requests/${id}/accept`);
  return data;
};

export const claimDropRequest = async (id: string): Promise<SwapRequestResponse> => {
  const { data } = await api.post<SwapRequestResponse>(`/swap-requests/${id}/claim`);
  return data;
};

export const cancelSwapRequest = async (
  id: string,
  reason?: string,
): Promise<SwapRequestResponse> => {
  const { data } = await api.post<SwapRequestResponse>(`/swap-requests/${id}/cancel`, {
    ...(reason ? { reason } : {}),
  });
  return data;
};

export const approveSwapRequest = async (id: string): Promise<SwapRequestResponse> => {
  const { data } = await api.post<SwapRequestResponse>(`/swap-requests/${id}/approve`);
  return data;
};

export const rejectSwapRequest = async (
  id: string,
  reason: string,
): Promise<SwapRequestResponse> => {
  const { data } = await api.post<SwapRequestResponse>(`/swap-requests/${id}/reject`, { reason });
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

export const getOvertimeReport = async (
  locationId: string,
  weekStart: string,
): Promise<OvertimeReportResponse> => {
  const { data } = await api.get<OvertimeReportResponse>('/reports/overtime', {
    params: { locationId, weekStart },
  });
  return data;
};

export const getFairnessReport = async (args: {
  locationId: string;
  startDate: string;
  endDate: string;
}): Promise<FairnessReportResponse> => {
  const { data } = await api.get<FairnessReportResponse>('/reports/fairness', {
    params: {
      locationId: args.locationId,
      startDate: args.startDate,
      endDate: args.endDate,
    },
  });
  return data;
};

export const getShiftAudit = async (
  shiftId: string,
  limit = 50,
): Promise<ShiftAuditResponse> => {
  const { data } = await api.get<ShiftAuditResponse>(`/shifts/${shiftId}/audit`, {
    params: { limit },
  });
  return data;
};

export const getAuditExport = async (args: {
  start: string;
  end: string;
  locationId?: string;
}): Promise<AuditExportResponse> => {
  const { data } = await api.get<AuditExportResponse>('/audit/export', {
    params: {
      start: args.start,
      end: args.end,
      ...(args.locationId ? { locationId: args.locationId } : {}),
      format: 'json',
    },
  });
  return data;
};

export const downloadAuditExportCsv = async (args: {
  start: string;
  end: string;
  locationId?: string;
}): Promise<Blob> => {
  const { data } = await api.get<Blob>('/audit/export', {
    params: {
      start: args.start,
      end: args.end,
      ...(args.locationId ? { locationId: args.locationId } : {}),
      format: 'csv',
    },
    responseType: 'blob',
  });
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
