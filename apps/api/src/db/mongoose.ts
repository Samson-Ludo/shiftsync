import mongoose from 'mongoose';
import { env } from '../config/env.js';

let isConnected = false;

export const connectToDatabase = async (): Promise<void> => {
  if (isConnected) {
    return;
  }

  await mongoose.connect(env.MONGODB_URI);
  isConnected = true;
};

export const disconnectFromDatabase = async (): Promise<void> => {
  if (!isConnected) {
    return;
  }

  await mongoose.disconnect();
  isConnected = false;
};