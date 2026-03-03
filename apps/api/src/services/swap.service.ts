import { ClientSession, Types } from 'mongoose';
import { DateTime } from 'luxon';
import { Server } from 'socket.io';
import {
  ManagerLocationModel,
  ShiftModel,
  SwapRequestDoc,
  SwapRequestModel,
  SwapRequestType,
  UserModel,
} from '../models/index.js';
import {
  createAndDispatchNotifications,
  PersistedNotification,
  simulateEmailForNotifications,
} from './notification.service.js';
import { recordAuditLog } from './audit.service.js';

export const ACTIVE_SWAP_REQUEST_STATUSES: SwapRequestDoc['status'][] = ['pending', 'accepted', 'claimed'];
export const APPROVAL_READY_SWAP_STATUSES: SwapRequestDoc['status'][] = ['accepted', 'claimed'];

export class SwapServiceError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SwapServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ShiftSummary = {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  title: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  startAtUtc: string;
};

type SwapRequestSummary = {
  _id: Types.ObjectId;
  type: SwapRequestType;
  shiftId: Types.ObjectId;
  fromStaffId: Types.ObjectId;
  toStaffId?: Types.ObjectId;
  status: SwapRequestDoc['status'];
  note?: string;
  expiresAtUtc: Date;
};

type SwapLifecycleAction =
  | 'requested'
  | 'accepted'
  | 'claimed'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

type SwapLifecycleContext = {
  io?: Server;
  swapRequest: SwapRequestSummary;
  shift: ShiftSummary;
  actorId: string;
  action: SwapLifecycleAction;
  reason?: string;
  managerIds?: string[];
};

type SwapEventPayload = {
  swapRequestId: string;
  type: SwapRequestType;
  shiftId: string;
  fromStaffId: string;
  toStaffId?: string;
  status: SwapRequestDoc['status'];
  locationId: string;
  occurredAtUtc: string;
  reason?: string;
};

type SwapLeanDoc = SwapRequestDoc & { _id: Types.ObjectId };
type ShiftLeanDoc = ShiftSummary;

const dedupeIds = (userIds: string[]): string[] => Array.from(new Set(userIds));

const getActionTitle = (action: SwapLifecycleAction, type: SwapRequestType): string => {
  if (action === 'requested') {
    return type === 'swap' ? 'Swap requested' : 'Drop request posted';
  }

  if (action === 'accepted') {
    return 'Swap accepted';
  }

  if (action === 'claimed') {
    return 'Drop request claimed';
  }

  if (action === 'approved') {
    return 'Swap coverage approved';
  }

  if (action === 'rejected') {
    return 'Swap coverage rejected';
  }

  if (action === 'cancelled') {
    return 'Swap coverage cancelled';
  }

  return 'Drop request expired';
};

const getActionBody = (args: {
  action: SwapLifecycleAction;
  type: SwapRequestType;
  shift: ShiftSummary;
  status: SwapRequestDoc['status'];
  reason?: string;
}): string => {
  const base = `${args.shift.title} on ${args.shift.localDate} (${args.shift.startLocalTime}-${args.shift.endLocalTime})`;

  if (args.action === 'requested') {
    return args.type === 'swap'
      ? `A swap request was submitted for ${base}.`
      : `A drop request was submitted for ${base}.`;
  }

  if (args.action === 'accepted') {
    return `Swap accepted for ${base}. Waiting for manager approval.`;
  }

  if (args.action === 'claimed') {
    return `Drop request claimed for ${base}. Waiting for manager approval.`;
  }

  if (args.action === 'approved') {
    return `Manager approved coverage change for ${base}.`;
  }

  if (args.action === 'rejected') {
    return `Manager rejected coverage change for ${base}.${args.reason ? ` Reason: ${args.reason}` : ''}`;
  }

  if (args.action === 'cancelled') {
    return `Coverage request was cancelled for ${base}.${args.reason ? ` Reason: ${args.reason}` : ''}`;
  }

  return `Drop request for ${base} expired before claim/approval.`;
};

const resolveSwapEventName = (
  action: SwapLifecycleAction,
): 'swap_requested' | 'swap_updated' | 'swap_cancelled' => {
  if (action === 'requested') {
    return 'swap_requested';
  }

  if (action === 'cancelled' || action === 'expired') {
    return 'swap_cancelled';
  }

  return 'swap_updated';
};

const buildSwapEventPayload = (args: {
  swapRequest: SwapRequestSummary;
  shift: ShiftSummary;
  reason?: string;
}): SwapEventPayload => ({
  swapRequestId: args.swapRequest._id.toString(),
  type: args.swapRequest.type,
  shiftId: args.swapRequest.shiftId.toString(),
  fromStaffId: args.swapRequest.fromStaffId.toString(),
  ...(args.swapRequest.toStaffId ? { toStaffId: args.swapRequest.toStaffId.toString() } : {}),
  status: args.swapRequest.status,
  locationId: args.shift.locationId.toString(),
  occurredAtUtc: new Date().toISOString(),
  ...(args.reason ? { reason: args.reason } : {}),
});

export const listManagerAndAdminIdsForLocation = async (
  locationId: Types.ObjectId,
  session?: ClientSession,
): Promise<string[]> => {
  const managerLocationQuery = ManagerLocationModel.find({ locationId }).select('managerId');
  if (session) {
    managerLocationQuery.session(session);
  }

  const adminsQuery = UserModel.find({ role: 'admin', active: true }).select('_id');
  if (session) {
    adminsQuery.session(session);
  }

  const [managerRows, adminRows] = await Promise.all([managerLocationQuery.lean(), adminsQuery.lean()]);

  return dedupeIds([
    ...managerRows.map((row) => row.managerId.toString()),
    ...adminRows.map((row) => row._id.toString()),
  ]);
};

export const dispatchSwapLifecycle = async (context: SwapLifecycleContext): Promise<void> => {
  const managerIds = context.managerIds ?? (await listManagerAndAdminIdsForLocation(context.shift.locationId));
  const participantIds = dedupeIds([
    context.swapRequest.fromStaffId.toString(),
    ...(context.swapRequest.toStaffId ? [context.swapRequest.toStaffId.toString()] : []),
    ...managerIds,
  ]);

  const title = getActionTitle(context.action, context.swapRequest.type);
  const body = getActionBody({
    action: context.action,
    type: context.swapRequest.type,
    shift: context.shift,
    status: context.swapRequest.status,
    reason: context.reason,
  });

  const notifications = await createAndDispatchNotifications({
    notifications: participantIds.map((userId) => ({
      userId: new Types.ObjectId(userId),
      type: 'swap_request',
      title,
      body,
      metadata: {
        swapRequestId: context.swapRequest._id.toString(),
        swapType: context.swapRequest.type,
        shiftId: context.swapRequest.shiftId.toString(),
        locationId: context.shift.locationId.toString(),
        action: context.action,
        status: context.swapRequest.status,
        actorId: context.actorId,
        ...(context.reason ? { reason: context.reason } : {}),
      },
    })),
    io: context.io,
  });

  const eventPayload = buildSwapEventPayload({
    swapRequest: context.swapRequest,
    shift: context.shift,
    reason: context.reason,
  });

  if (context.io) {
    const eventName = resolveSwapEventName(context.action);

    context.io.to(`location:${context.shift.locationId.toString()}`).emit(eventName, eventPayload);
    for (const userId of participantIds) {
      context.io.to(`user:${userId}`).emit(eventName, eventPayload);
    }
  }

  void simulateEmailForNotifications(notifications as PersistedNotification[]);
};

export const countActiveSwapRequestsForStaff = async (
  staffId: Types.ObjectId,
  session?: ClientSession,
): Promise<number> => {
  const query = SwapRequestModel.countDocuments({
    fromStaffId: staffId,
    status: { $in: ACTIVE_SWAP_REQUEST_STATUSES },
  });

  if (session) {
    query.session(session);
  }

  return query;
};

export const calculateDropExpiryUtc = (shiftStartAtUtc: string): Date => {
  return DateTime.fromISO(shiftStartAtUtc, { zone: 'utc' }).minus({ hours: 24 }).toJSDate();
};

export const cancelNonFinalSwapRequestsForShift = async (args: {
  shiftId: Types.ObjectId;
  reason: string;
  actorId: string;
  session?: ClientSession;
}): Promise<SwapRequestSummary[]> => {
  const query = SwapRequestModel.find({
    shiftId: args.shiftId,
    status: { $in: ACTIVE_SWAP_REQUEST_STATUSES },
  }).select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc');

  if (args.session) {
    query.session(args.session);
  }

  const pending = (await query.lean()) as SwapLeanDoc[];
  if (pending.length === 0) {
    return [];
  }

  const ids = pending.map((request) => request._id);
  const updateQuery = SwapRequestModel.updateMany(
    {
      _id: { $in: ids },
      status: { $in: ACTIVE_SWAP_REQUEST_STATUSES },
    },
    {
      $set: {
        status: 'cancelled',
        note: args.reason,
      },
    },
  );

  if (args.session) {
    updateQuery.session(args.session);
  }

  await updateQuery;

  return pending.map((request) => ({
    _id: request._id,
    type: request.type,
    shiftId: request.shiftId,
    fromStaffId: request.fromStaffId,
    toStaffId: request.toStaffId,
    status: 'cancelled',
    note: args.reason,
    expiresAtUtc: request.expiresAtUtc,
  }));
};

export const dispatchCancelledSwapRequests = async (args: {
  cancelled: SwapRequestSummary[];
  shift: ShiftSummary;
  actorId: string;
  reason: string;
  io?: Server;
}): Promise<void> => {
  if (args.cancelled.length === 0) {
    return;
  }

  const managerIds = await listManagerAndAdminIdsForLocation(args.shift.locationId);

  for (const request of args.cancelled) {
    await dispatchSwapLifecycle({
      io: args.io,
      swapRequest: request,
      shift: args.shift,
      actorId: args.actorId,
      action: 'cancelled',
      reason: args.reason,
      managerIds,
    });
  }
};

const shouldExpireDropRequest = (args: {
  shiftStartAtUtc: string;
  expiresAtUtc: Date;
  nowUtc: DateTime;
}): boolean => {
  const shiftStart = DateTime.fromISO(args.shiftStartAtUtc, { zone: 'utc' });
  const within24Hours = shiftStart.diff(args.nowUtc, 'hours').hours <= 24;
  const explicitExpiryReached = DateTime.fromJSDate(args.expiresAtUtc, { zone: 'utc' }) <= args.nowUtc;

  return within24Hours || explicitExpiryReached;
};

export const expireDropRequests = async (args: {
  io?: Server;
  actorId?: string;
}): Promise<number> => {
  const nowUtc = DateTime.utc();

  const candidates = (await SwapRequestModel.find({
    type: 'drop',
    status: 'pending',
  })
    .select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc')
    .lean()) as SwapLeanDoc[];

  if (candidates.length === 0) {
    return 0;
  }

  const shiftIds = dedupeIds(candidates.map((request) => request.shiftId.toString())).map(
    (id) => new Types.ObjectId(id),
  );

  const shifts = (await ShiftModel.find({ _id: { $in: shiftIds } })
    .select('_id locationId title localDate startLocalTime endLocalTime startAtUtc')
    .lean()) as ShiftLeanDoc[];

  const shiftById = new Map(shifts.map((shift) => [shift._id.toString(), shift]));
  const actorId = args.actorId ?? 'swap-expiry-worker';
  let expiredCount = 0;

  for (const request of candidates) {
    const shift = shiftById.get(request.shiftId.toString());
    if (!shift) {
      continue;
    }

    if (
      !shouldExpireDropRequest({
        shiftStartAtUtc: shift.startAtUtc,
        expiresAtUtc: request.expiresAtUtc,
        nowUtc,
      })
    ) {
      continue;
    }

    const updated = (await SwapRequestModel.findOneAndUpdate(
      {
        _id: request._id,
        status: 'pending',
      },
      {
        $set: {
          status: 'expired',
          note: 'Drop request expired before claim/approval.',
        },
      },
      { new: true },
    )
      .select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc')
      .lean()) as SwapLeanDoc | null;

    if (!updated) {
      continue;
    }

    await recordAuditLog({
      actorId,
      action: 'swap_request_expired',
      entityType: 'swap_request',
      entityId: updated._id.toString(),
      locationId: shift.locationId,
      beforeSnapshot: {
        type: request.type,
        status: request.status,
        shiftId: request.shiftId.toString(),
        fromStaffId: request.fromStaffId.toString(),
        toStaffId: request.toStaffId?.toString() ?? null,
        note: request.note ?? null,
        expiresAtUtc: request.expiresAtUtc.toISOString(),
      },
      afterSnapshot: {
        type: updated.type,
        status: updated.status,
        shiftId: updated.shiftId.toString(),
        fromStaffId: updated.fromStaffId.toString(),
        toStaffId: updated.toStaffId?.toString() ?? null,
        note: updated.note ?? null,
        expiresAtUtc: updated.expiresAtUtc.toISOString(),
      },
      payload: {
        shiftId: shift._id.toString(),
      },
    });

    expiredCount += 1;

    await dispatchSwapLifecycle({
      io: args.io,
      swapRequest: {
        _id: updated._id,
        type: updated.type,
        shiftId: updated.shiftId,
        fromStaffId: updated.fromStaffId,
        toStaffId: updated.toStaffId,
        status: updated.status,
        note: updated.note,
        expiresAtUtc: updated.expiresAtUtc,
      },
      shift,
      actorId,
      action: 'expired',
      reason: updated.note,
    });
  }

  return expiredCount;
};
