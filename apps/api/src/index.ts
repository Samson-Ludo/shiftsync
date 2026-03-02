import http from 'http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase } from './db/mongoose.js';

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
      next();
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
    if (socket.data.userId) {
      socket.join(`user:${socket.data.userId}`);
    }

    socket.emit('socket:ready', { connectedAt: new Date().toISOString() });
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