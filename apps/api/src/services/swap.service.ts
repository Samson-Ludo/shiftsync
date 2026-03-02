import { Types } from 'mongoose';
import { SwapRequestModel } from '../models/index.js';

export const cancelPendingSwapRequestsForShift = async (
  shiftId: string,
  reason: string,
): Promise<number> => {
  if (!Types.ObjectId.isValid(shiftId)) {
    return 0;
  }

  // TODO: Add notification fanout and richer audit context once swap flows are implemented.
  const result = await SwapRequestModel.updateMany(
    {
      shiftId: new Types.ObjectId(shiftId),
      status: 'pending',
    },
    {
      $set: {
        status: 'cancelled',
        note: reason,
      },
    },
  );

  return result.modifiedCount;
};