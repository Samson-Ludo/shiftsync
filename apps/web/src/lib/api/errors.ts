export class ApiError extends Error {
  status: number;
  data?: unknown;
  code?: string;

  constructor(message: string, status = 500, data?: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = code;
  }
}