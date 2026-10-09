import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['test/setup.ts', 'src/test-no-network.ts'],
    // Os testes de integração compartilham um banco: roda em sequência.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
