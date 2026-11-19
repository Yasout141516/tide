import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Renderer tests opt in to jsdom with a `// @vitest-environment jsdom` docblock.
    setupFiles: ['tests/renderer/setup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] }
      },
      {
        // jsdom tests are slow under full-suite load: a generous per-test limit, not a retry.
        extends: true,
        test: {
          name: 'renderer',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          testTimeout: 15_000
        }
      }
    ]
  }
})
