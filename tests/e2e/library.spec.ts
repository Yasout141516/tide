import { copyFileSync, mkdirSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { test, expect } from '@playwright/test'
import { launchTide } from './launch'

test('adds a reading under a new course and keeps it after a restart', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'tide-e2e-'))
  const folder = join(await mkdtemp(join(tmpdir(), 'tide-pdf-')), 'my readings ü')
  mkdirSync(folder)
  const fileName = 'Wéek 4 – Memory_and_Attention.pdf'
  const pdf = join(folder, fileName)
  copyFileSync(resolve(__dirname, '..', 'fixtures', 'pdfs', 'single-column.pdf'), pdf)

  let app = await launchTide({ TIDE_USER_DATA: userData })
  // The file dialog is stubbed from the main process; no production hook is involved.
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never
  }, pdf)
  let win = await app.firstWindow()
  // The shelf (and its button) is visible at the default window size.
  await win.getByRole('button', { name: 'Add reading' }).click()

  const picker = win.getByRole('dialog', { name: 'Which course is this for?' })
  await expect(picker.getByText(fileName)).toBeVisible()
  await expect(picker.getByText('4 pages')).toBeVisible()
  await picker.getByRole('button', { name: '＋ New course' }).click()
  await picker.getByPlaceholder('Course name, e.g. PSYC 201').fill('PSYC 201')
  await picker.getByRole('button', { name: 'Add to shelf' }).click()

  const shelf = win.getByRole('navigation', { name: 'Readings' })
  await expect(shelf.getByRole('button', { name: 'PSYC 201', exact: true })).toBeVisible()
  // The fixture carries a real PDF title, so the row is named by that, not by the file name.
  const row = shelf.getByRole('button', { name: /Week 4/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('New')
  await app.close()

  app = await launchTide({ TIDE_USER_DATA: userData })
  win = await app.firstWindow()
  const shelf2 = win.getByRole('navigation', { name: 'Readings' })
  await expect(shelf2.getByRole('button', { name: 'PSYC 201', exact: true })).toBeVisible()
  await expect(shelf2.getByRole('button', { name: /Week 4/ })).toBeVisible()
  await app.close()
})
