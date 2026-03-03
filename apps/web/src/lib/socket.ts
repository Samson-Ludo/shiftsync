import { io, Socket } from 'socket.io-client';
import { getToken } from '@/lib/api/auth';

let socketInstance: Socket | null = null;
let socketKey: string | null = null;
const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const getSocket = (token: string | null, apiBaseUrl: string): Socket => {
  const nextKey = `${apiBaseUrl}::${token ?? 'anonymous'}`;

  if (socketInstance && socketKey === nextKey) {
    return socketInstance;
  }

  if (socketInstance) {
    socketInstance.disconnect();
  }

  socketKey = nextKey;
  socketInstance = io(apiBaseUrl, {
    transports: ['websocket'],
    auth: token ? { token } : undefined,
  });

  return socketInstance;
};

export const connectSocketWithStoredToken = (): Socket | null => {
  const token = getToken();
  if (!token) {
    return null;
  }

  return getSocket(token, defaultApiBaseUrl);
};

export const disconnectSocket = (): void => {
  if (!socketInstance) {
    socketKey = null;
    return;
  }

  socketInstance.disconnect();
  socketInstance = null;
  socketKey = null;
};
