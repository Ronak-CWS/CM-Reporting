import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 15000,
    hookTimeout: 30000,
    clearMocks: true,
  },
});
