import { copyFileSync, mkdirSync, renameSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { test, expect } from '@playwright/test'
import { launchTide, spawnSecond } from './launch'

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

const fixture = (name: string): string => resolve(__dirname, '..', 'fixtures', 'pdfs', name)

async function copyTo(name: string, as: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tide-pdf-'))
  const dest = join(dir, as)
  copyFileSync(fixture(name), dest)
  return dest
}

test('Open With on a new file shows the course picker; on a known file opens it', async () => {
  const pdf = await copyTo('single-column.pdf', 'first.pdf')
  const app = await launchTide()
  const win = await app.firstWindow()
  await win.getByRole('button', { name: 'Add reading' }).first().waitFor()
  // macOS "open-file", stubbed from the main process; no production hook is involved.
  const openFile = (p: string): Promise<void> =>
    app.evaluate(({ app }, p) => {
      app.emit('open-file', { preventDefault: () => undefined }, p)
    }, p)

  await openFile(pdf)
  const picker = win.getByRole('dialog', { name: 'Which course is this for?' })
  await expect(picker.getByText('first.pdf')).toBeVisible()
  await picker.getByRole('button', { name: 'Skip' }).click()
  const shelf = win.getByRole('navigation', { name: 'Readings' })
  await expect(shelf.getByRole('button', { name: 'Other', exact: true })).toBeVisible()
  const row = shelf.getByRole('button', { name: /Week 4/ })
  await expect(row).toBeVisible()

  // Add a second reading, which becomes the selection, so the hand-off below must change it back.
  const other = await copyTo('two-column.pdf', 'other.pdf')
  await openFile(other)
  await picker.getByRole('button', { name: 'Skip' }).click()
  await expect(win.getByRole('heading', { level: 2 })).not.toContainText('Week 4')

  // The first file under a new path is recognised: no picker, still one row, and it is selected.
  const copy = await copyTo('single-column.pdf', 'copy of first.pdf')
  await openFile(copy)
  await expect(win.getByRole('heading', { level: 2, name: /Week 4/ })).toBeVisible()
  await expect(picker).toHaveCount(0)
  await expect(shelf.getByRole('button', { name: /Week 4/ })).toHaveCount(1)
  await app.close()
})

test('a second launch with a PDF hands it to the running Tide', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'tide-e2e-'))
  const pdf2 = await copyTo('single-column.pdf', 'second launch.pdf')
  const app = await launchTide({ TIDE_USER_DATA: userData })
  const win = await app.firstWindow()
  await win.getByRole('button', { name: 'Add reading' }).first().waitFor()

  const code = await spawnSecond([pdf2], { TIDE_E2E: '1', TIDE_USER_DATA: userData })
  expect(code).toBe(0)
  const picker = win.getByRole('dialog', { name: 'Which course is this for?' })
  await expect(picker.getByText('second launch.pdf')).toBeVisible()
  await app.close()
})

test('a moved file shows "File moved · Find it" and Find the file re-links it', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'tide-e2e-'))
  const pdf = await copyTo('single-column.pdf', 'before.pdf')
  const stubDialog = (app: Awaited<ReturnType<typeof launchTide>>, p: string): Promise<void> =>
    app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never
    }, p)

  let app = await launchTide({ TIDE_USER_DATA: userData })
  await stubDialog(app, pdf)
  let win = await app.firstWindow()
  await win.getByRole('button', { name: 'Add reading' }).first().click()
  await win
    .getByRole('dialog', { name: 'Which course is this for?' })
    .getByRole('button', { name: 'Skip' })
    .click()
  await expect(
    win.getByRole('navigation', { name: 'Readings' }).getByRole('button', { name: /Week 4/ })
  ).toBeVisible()
  await app.close()

  // She renames the file in Explorer / Finder while Tide is closed.
  const moved = join(pdf, '..', 'after renaming.pdf')
  renameSync(pdf, moved)

  app = await launchTide({ TIDE_USER_DATA: userData })
  win = await app.firstWindow()
  const row = win
    .getByRole('navigation', { name: 'Readings' })
    .getByRole('button', { name: /Week 4/ })
  await expect(row).toContainText('File moved · Find it')
  await row.click()
  const dialog = win.getByRole('dialog', { name: 'Where did this one go?' })
  await expect(dialog).toBeVisible()
  await stubDialog(app, moved)
  await dialog.getByRole('button', { name: 'Find the file' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row).not.toContainText('File moved · Find it')
  await expect(win.getByRole('heading', { level: 2, name: /Week 4/ })).toBeVisible()
  await app.close()
})
