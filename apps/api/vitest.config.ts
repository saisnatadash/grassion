import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // Stub avoids Postgres connection on module init while exporting real schema tables + getDb.
      '@grassion/db': path.resolve(__dirname, 'src/__test-stubs__/grassion-db.ts'),
      '@grassion/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
})
