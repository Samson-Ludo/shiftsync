import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appEnv } from '@/lib/env';

const getToken = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  return cookieStore.get('shiftsync_token')?.value ?? null;
};

export async function GET() {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const response = await fetch(`${appEnv.apiBaseUrl}/notifications`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}