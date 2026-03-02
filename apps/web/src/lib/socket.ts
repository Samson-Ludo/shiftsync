import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;
let socketKey: string | null = null;

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
