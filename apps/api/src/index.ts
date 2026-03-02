import http from 'http';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase } from './db/mongoose.js';
import { ManagerLocationModel } from './models/index.js';

const start = async () => {
  await connectToDatabase();

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      next(new Error('Unauthorized'));
      return;
    }

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as {
        userId: string;
        role: string;
      };
      socket.data.userId = payload.userId;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error('Unauthorized')); 
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string | undefined;
    const role = socket.data.role as string | undefined;

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.join(`user:${userId}`);

    const joinLocationRooms = async () => {
      if (role !== 'manager' || !Types.ObjectId.isValid(userId)) {
        return [];
      }

      const managerLocations = await ManagerLocationModel.find({
        managerId: new Types.ObjectId(userId),
      })
        .select('locationId')
        .lean();

      const joinedRooms = managerLocations.map((row) => `location:${row.locationId.toString()}`);
      for (const room of joinedRooms) {
        socket.join(room);
      }
      return joinedRooms;
    };

    void joinLocationRooms()
      .then((joinedRooms) => {
        socket.emit('socket:ready', {
          connectedAt: new Date().toISOString(),
          rooms: [`user:${userId}`, ...joinedRooms],
        });
      })
      .catch(() => {
        socket.emit('socket:ready', {
          connectedAt: new Date().toISOString(),
          rooms: [`user:${userId}`],
        });
      });
  });

  app.set('io', io);

  server.listen(env.PORT, () => {
    console.log(`ShiftSync API listening on http://localhost:${env.PORT}`);
  });
};

start().catch((error) => {
  console.error('Failed to boot API', error);
  process.exit(1);
});
