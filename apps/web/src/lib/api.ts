import { appEnv } from './env';

type RequestOptions = {
  token?: string;
  method?: string;
  body?: unknown;
  query?: string;
};

export const callApi = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const url = `${appEnv.apiBaseUrl}${path}${options.query ?? ''}`;

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(`API error (${response.status}): ${text || response.statusText}`);
  }

  return payload;
};