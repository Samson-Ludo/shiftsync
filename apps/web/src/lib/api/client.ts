import axios from 'axios';
import { getToken } from './auth';
import { ApiError } from './errors';

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!baseURL) {
  // eslint-disable-next-line no-console
  console.warn('NEXT_PUBLIC_API_BASE_URL is not set. API client calls will fail.');
}

export const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 500;
      const data = error.response?.data;
      const code =
        (typeof data === 'object' &&
        data &&
        'code' in data &&
        typeof (data as { code?: unknown }).code === 'string'
          ? (data as { code: string }).code
          : undefined) ?? error.code;

      const message =
        (typeof data === 'object' &&
        data &&
        'message' in data &&
        typeof (data as { message?: unknown }).message === 'string'
          ? (data as { message: string }).message
          : undefined) ?? error.message;

      throw new ApiError(message, status, data, code);
    }

    throw new ApiError('Unexpected network error', 500, undefined, 'UNEXPECTED_ERROR');
  },
);
