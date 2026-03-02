import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appEnv } from '@/lib/env';

const getToken = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  return cookieStore.get('shiftsync_token')?.value ?? null;
};

export async function PATCH(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const response = await fetch(`${appEnv.apiBaseUrl}/notifications/${params.id}/read`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}