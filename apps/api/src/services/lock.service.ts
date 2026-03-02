import { DateTime } from 'luxon';
import { LockModel } from '../models/index.js';

const DEFAULT_LOCK_SECONDS = 15;

export type ReservationLock = {
  key: string;
  owner: string;
  expiresAtUtc: Date;
};

export class ResourceLockedError extends Error {
  key: string;

  constructor(message: string, key: string) {
    super(message);
    this.name = 'ResourceLockedError';
    this.key = key;
  }
}

export const buildStaffLockKey = (staffId: string): string => `staff:${staffId}`;

export const acquireReservationLock = async (args: {
  key: string;
  owner: string;
  ttlSeconds?: number;
}): Promise<ReservationLock> => {
  const ttlSeconds = args.ttlSeconds ?? DEFAULT_LOCK_SECONDS;
  const now = DateTime.utc();

  await LockModel.findOneAndDelete({
    key: args.key,
    expiresAtUtc: { $lte: now.toJSDate() },
  });

  const lock: ReservationLock = {
    key: args.key,
    owner: args.owner,
    expiresAtUtc: now.plus({ seconds: ttlSeconds }).toJSDate(),
  };

  try {
    await LockModel.create(lock);
    return lock;
  } catch (error: unknown) {
    const maybeMongoError = error as { code?: number };
    if (maybeMongoError.code === 11000) {
      throw new ResourceLockedError('Resource is currently locked by another operation.', args.key);
    }
    throw error;
  }
};

export const releaseReservationLock = async (lock: ReservationLock): Promise<void> => {
  await LockModel.deleteOne({ key: lock.key, owner: lock.owner });
};
