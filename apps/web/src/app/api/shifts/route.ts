import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appEnv } from '@/lib/env';

const getToken = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  return cookieStore.get('shiftsync_token')?.value ?? null;
};

export async function GET(request: NextRequest) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.toString();
  const url = `${appEnv.apiBaseUrl}/shifts${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}

export async function POST(request: NextRequest) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const response = await fetch(`${appEnv.apiBaseUrl}/shifts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}