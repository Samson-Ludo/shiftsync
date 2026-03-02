export const appEnv = {
  apiBaseUrl:
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
};