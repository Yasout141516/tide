import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/renderer/**/*.test.{ts,tsx}'],
    // Renderer tests opt in to jsdom with a `// @vitest-environment jsdom` docblock.
    setupFiles: ['tests/renderer/setup.ts']
  }
})
