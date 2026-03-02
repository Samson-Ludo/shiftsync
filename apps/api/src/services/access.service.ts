import { Types } from 'mongoose';
import { ManagerLocationModel, StaffCertificationModel } from '../models/index.js';
import { AuthUser } from '../middleware/auth.js';

export const getManagerLocationIds = async (managerId: string): Promise<string[]> => {
  const rows = await ManagerLocationModel.find({ managerId: new Types.ObjectId(managerId) })
    .select('locationId')
    .lean();

  return rows.map((row) => row.locationId.toString());
};

export const getStaffCertifiedLocationIds = async (staffId: string): Promise<string[]> => {
  const rows = await StaffCertificationModel.find({ staffId: new Types.ObjectId(staffId) })
    .select('locationId')
    .lean();

  return rows.map((row) => row.locationId.toString());
};

export const canManageLocation = async (user: AuthUser, locationId: string): Promise<boolean> => {
  if (user.role === 'admin') {
    return true;
  }

  if (user.role !== 'manager') {
    return false;
  }

  const managedLocations = await getManagerLocationIds(user.userId);
  return managedLocations.includes(locationId);
};