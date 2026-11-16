import { test, expect, _electron as electron } from '@playwright/test'
test('window opens titled Tide', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, TIDE_E2E: '1' } })
  const win = await app.firstWindow()
  await expect(win).toHaveTitle('Tide')
  await expect(win.getByText('Tide')).toBeVisible()
  await app.close()
})
