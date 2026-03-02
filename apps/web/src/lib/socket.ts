'use client';

import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export const getSocket = (token: string | null, apiBaseUrl: string): Socket => {
  if (socketInstance) {
    return socketInstance;
  }

  socketInstance = io(apiBaseUrl, {
    transports: ['websocket'],
    auth: token ? { token } : undefined,
  });

  return socketInstance;
};
