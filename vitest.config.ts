import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/server/**/*.test.ts'], setupFiles: ['scripts/test-env.ts'], fileParallelism: false, testTimeout: 15000, hookTimeout: 30000 } });
