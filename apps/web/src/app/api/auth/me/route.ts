import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appEnv } from '@/lib/env';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('shiftsync_token')?.value;

  if (!token) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  const response = await fetch(`${appEnv.apiBaseUrl}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}