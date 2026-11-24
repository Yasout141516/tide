import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../../src/shared/ipc-types'

// buildFromTemplate returns the template itself, so the test can walk it; no Electron runs.
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (t: unknown) => t }
}))

const { buildMenu } = await import('../../src/main/menu')

function items(): MenuItemConstructorOptions[] {
  const template = buildMenu(() => {}) as unknown as MenuItemConstructorOptions[]
  return template.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []))
}

function click(accelerator: string): AppCommand[] {
  const sent: AppCommand[] = []
  const template = buildMenu((c) => sent.push(c)) as unknown as MenuItemConstructorOptions[]
  const all = template.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []))
  const item = all.find((i) => i.accelerator === accelerator)
  expect(item, accelerator).toBeDefined()
  ;(item!.click as () => void)()
  return sent
}

describe('buildMenu', () => {
  it('File > Add reading… is CmdOrCtrl+O and sends add-reading', () => {
    expect(items().find((i) => i.label === 'Add reading…')?.accelerator).toBe('CmdOrCtrl+O')
    expect(click('CmdOrCtrl+O')).toEqual([{ type: 'add-reading' }])
  })

  it('Larger text is CmdOrCtrl+= and the CmdOrCtrl+Plus alias, both zoom +1', () => {
    expect(click('CmdOrCtrl+=')).toEqual([{ type: 'zoom', step: 1 }])
    expect(click('CmdOrCtrl+Plus')).toEqual([{ type: 'zoom', step: 1 }])
  })

  it('Smaller text is CmdOrCtrl+- and sends zoom -1', () => {
    expect(click('CmdOrCtrl+-')).toEqual([{ type: 'zoom', step: -1 }])
  })

  it('Settings… has CmdOrCtrl+, and sends { type: "settings" }', () => {
    expect(items().find((i) => i.label === 'Settings…')?.accelerator).toBe('CmdOrCtrl+,')
    expect(click('CmdOrCtrl+,')).toEqual([{ type: 'settings' }])
  })

  it('the Help items are disabled reminders', () => {
    const help = items().filter((i) => /Add reading$|Text size|sentence/.test(i.label ?? ''))
    expect(help.filter((i) => i.enabled === false)).toHaveLength(3)
  })
})
