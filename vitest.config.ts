import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { CM_AUTH_MODE: 'development', NEXT_PUBLIC_BASE_PATH: '', REPORT_EMAIL_ENABLED: 'false' },
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 15000,
    hookTimeout: 30000,
    clearMocks: true,
  },
});
