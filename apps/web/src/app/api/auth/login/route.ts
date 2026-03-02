import { NextRequest, NextResponse } from 'next/server';
import { appEnv } from '@/lib/env';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email: string; password: string };

  const response = await fetch(`${appEnv.apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();

  if (!response.ok) {
    return NextResponse.json(payload, { status: response.status });
  }

  const nextResponse = NextResponse.json({ user: payload.user });
  nextResponse.cookies.set('shiftsync_token', payload.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  return nextResponse;
}