import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // config.ts calls required('PRIVY_APP_ID') at module load. We mock every
    // service that would otherwise drag it in, but set it here too so a stray
    // real import can't blow up the suite.
    env: {
      PRIVY_APP_ID: 'test-app-id',
      NODE_ENV: 'test',
    },
  },
});
