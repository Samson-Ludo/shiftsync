import { defineConfig } from '@playwright/test';

const localWebPort = Number(process.env.E2E_LOCAL_WEB_PORT ?? '3001');
const localApiPort = Number(process.env.E2E_LOCAL_API_PORT ?? '4001');
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${localWebPort}`;
const apiBaseURL = process.env.E2E_API_BASE_URL ?? `http://localhost:${localApiPort}`;
const useExternalBaseURL = Boolean(process.env.E2E_BASE_URL);
const reuseExistingServer = process.env.E2E_REUSE_EXISTING_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 240_000,
  expect: {
    timeout: 45_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'on',
  },
  webServer: useExternalBaseURL
    ? undefined
    : [
        {
          command: 'npm run build -w apps/api && npm run start -w apps/api',
          cwd: '../..',
          url: `${apiBaseURL}/health`,
          timeout: 360_000,
          reuseExistingServer,
          env: {
            ...process.env,
            PORT: String(localApiPort),
            CLIENT_ORIGIN: baseURL,
          },
        },
        {
          command: `npm run build -w apps/web && npm run start -w apps/web -- -p ${localWebPort}`,
          cwd: '../..',
          url: `${baseURL}/login`,
          timeout: 420_000,
          reuseExistingServer,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_BASE_URL: apiBaseURL,
          },
        },
      ],
});
