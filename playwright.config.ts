import { defineConfig } from '@playwright/test'

// Some shells/IDEs export this, which makes Electron boot as plain Node and the launch fail.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: 'list'
})
