import { defineConfig } from '@playwright/test'

// Some shells/IDEs export this, which makes Electron boot as plain Node and the launch fail.
delete process.env.ELECTRON_RUN_AS_NODE

// TIDE_PACKAGED=1 runs the same specs against the packaged app in release/ (tests/e2e/launch.ts).
const packaged = process.env.TIDE_PACKAGED === '1'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: 'list',
  // Each test launches Electron plus the fp32 voice engine; parallel workers time out on voice load.
  workers: 1,
  fullyParallel: false,
  projects: [
    packaged
      ? // First launch of a freshly packaged app (signature checks, cold disk cache) is slower.
        { name: 'packaged', timeout: 120_000 }
      : { name: 'dev' }
  ]
})
