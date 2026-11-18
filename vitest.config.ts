import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/security.test.ts',
      'tests/unit-comprehensive.test.ts',
      'tests/worker.test.ts',
    ],
  },
});
