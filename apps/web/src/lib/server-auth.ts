import { cookies } from 'next/headers';
import { appEnv } from './env';
import { CurrentUser } from './types';

export const getAuthToken = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  return cookieStore.get('shiftsync_token')?.value ?? null;
};

export const fetchCurrentUser = async (): Promise<CurrentUser | null> => {
  const token = await getAuthToken();
  if (!token) {
    return null;
  }

  const response = await fetch(`${appEnv.apiBaseUrl}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { user: CurrentUser };
  return data.user;
};