import { ClientSession, Types } from 'mongoose';
import { Server } from 'socket.io';
import { NotificationModel, UserModel } from '../models/index.js';
import { NotificationPreference } from '../models/user.model.js';
import { NotificationDoc } from '../models/notification.model.js';

export type CreateNotificationInput = {
  userId: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
};

type NotificationCreatedPayload = {
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

export type PersistedNotification = NotificationDoc & { _id: Types.ObjectId };

const buildEmailPreview = (title: string, body: string): string => `${title} :: ${body}`;

const toObjectIdString = (value: unknown): string => {
  if (value instanceof Types.ObjectId) {
    return value.toString();
  }
  return String(value);
};

const mergeMetadata = (
  base: Record<string, unknown> | undefined,
  preference: NotificationPreference,
  preview: string,
): Record<string, unknown> => {
  if (preference === 'in_app_plus_email_sim') {
    return {
      ...(base ?? {}),
      emailSimulated: true,
      emailPreview: preview,
    };
  }

  return {
    ...(base ?? {}),
    emailSimulated: false,
  };
};

export const emitNotificationCreated = (args: {
  io: Server;
  notifications: PersistedNotification[];
}): void => {
  for (const notification of args.notifications) {
    const payload: NotificationCreatedPayload = {
      notificationId: toObjectIdString(notification._id),
      userId: toObjectIdString(notification.userId),
      type: notification.type,
      title: notification.title,
      body: notification.body,
      read: notification.read,
      createdAt: notification.createdAt.toISOString(),
    };

    args.io.to(`user:${payload.userId}`).emit('notification_created', payload);
  }
};

export const createAndDispatchNotifications = async (args: {
  notifications: CreateNotificationInput[];
  io?: Server;
  session?: ClientSession;
  simulateEmailAsync?: boolean;
}): Promise<PersistedNotification[]> => {
  if (args.notifications.length === 0) {
    return [];
  }

  const userIds = Array.from(new Set(args.notifications.map((entry) => entry.userId.toString()))).map(
    (id) => new Types.ObjectId(id),
  );

  const usersQuery = UserModel.find({ _id: { $in: userIds } })
    .select('email notificationPreference')
    .lean();
  if (args.session) {
    usersQuery.session(args.session);
  }

  const users = await usersQuery;
  const userById = new Map(
    users.map((user) => [
      user._id.toString(),
      {
        email: user.email,
        preference: user.notificationPreference ?? 'in_app_only',
      },
    ]),
  );

  const docs = args.notifications.map((entry) => {
    const user = userById.get(entry.userId.toString());
    const preference = user?.preference ?? 'in_app_only';
    const emailPreview = buildEmailPreview(entry.title, entry.body);

    return {
      userId: entry.userId,
      type: entry.type,
      title: entry.title,
      body: entry.body,
      read: false,
      metadata: mergeMetadata(entry.metadata, preference, emailPreview),
    };
  });

  const inserted = await NotificationModel.insertMany(docs, {
    session: args.session,
    ordered: true,
  });

  if (args.io) {
    emitNotificationCreated({ io: args.io, notifications: inserted });
  }

  if (args.simulateEmailAsync ?? true) {
    // Non-blocking email simulation logging.
    setImmediate(() => {
      for (const notification of inserted) {
        const user = userById.get(notification.userId.toString());
        if (!user || user.preference !== 'in_app_plus_email_sim') {
          continue;
        }

        const preview = buildEmailPreview(notification.title, notification.body);
        console.log(
          `[email-sim] to=${user.email} notificationId=${notification._id.toString()} preview="${preview}"`,
        );
      }
    });
  }

  return inserted as PersistedNotification[];
};

export const simulateEmailForNotifications = async (
  notifications: PersistedNotification[],
): Promise<void> => {
  const emailEligible = notifications.filter((notification) => {
    const metadata = notification.metadata as Record<string, unknown> | undefined;
    return metadata?.emailSimulated === true;
  });

  if (emailEligible.length === 0) {
    return;
  }

  const userIds = Array.from(new Set(emailEligible.map((entry) => entry.userId.toString()))).map(
    (id) => new Types.ObjectId(id),
  );

  const users = await UserModel.find({ _id: { $in: userIds } }).select('email').lean();
  const userById = new Map(users.map((user) => [user._id.toString(), user.email]));

  for (const notification of emailEligible) {
    const email = userById.get(notification.userId.toString());
    if (!email) {
      continue;
    }

    const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
    const preview =
      typeof metadata.emailPreview === 'string'
        ? metadata.emailPreview
        : buildEmailPreview(notification.title, notification.body);

    console.log(
      `[email-sim] to=${email} notificationId=${notification._id.toString()} preview="${preview}"`,
    );
  }
};
