import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../../src/shared/ipc-types'

// buildFromTemplate returns the template itself, so the test can walk it; no Electron runs.
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (t: unknown) => t }
}))

const { buildMenu } = await import('../../src/main/menu')

type Actions = { about: () => void; licences: () => void }

function template(
  send: (c: AppCommand) => void = () => {},
  actions: Actions = { about: () => {}, licences: () => {} }
): MenuItemConstructorOptions[] {
  return buildMenu(send, actions) as unknown as MenuItemConstructorOptions[]
}

function submenu(label: string, actions?: Actions): MenuItemConstructorOptions[] {
  const sub = template(() => {}, actions).find((m) => m.label === label)?.submenu
  return Array.isArray(sub) ? sub : []
}

function items(actions?: Actions): MenuItemConstructorOptions[] {
  return template(() => {}, actions).flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []))
}

/** Runs fn with process.platform temporarily set to p. */
function withPlatform<T>(p: NodeJS.Platform, fn: () => T): T {
  const orig = process.platform
  Object.defineProperty(process, 'platform', { value: p })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: orig })
  }
}

function click(accelerator: string): AppCommand[] {
  const sent: AppCommand[] = []
  const item = template((c) => sent.push(c))
    .flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []))
    .find((i) => i.accelerator === accelerator)
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

  it('on win32 Help ends with a separator and About Tide, which calls the handler', () => {
    withPlatform('win32', () => {
      const about = vi.fn()
      const help = submenu('Help', { about, licences: () => {} })
      const idx = help.findIndex((i) => i.label === 'About Tide')
      expect(idx).toBeGreaterThan(0)
      expect(help[idx - 1].type).toBe('separator')
      ;(help[idx].click as () => void)()
      expect(about).toHaveBeenCalledTimes(1)
    })
  })

  it.each(['win32', 'darwin'] as const)(
    'on %s View licences is only in Help and calls the handler',
    (p) => {
      withPlatform(p, () => {
        const licences = vi.fn()
        const actions = { about: () => {}, licences }
        const item = submenu('Help', actions).find((i) => i.label === 'View licences')
        expect(item).toBeDefined()
        ;(item!.click as () => void)()
        expect(licences).toHaveBeenCalledTimes(1)
        expect(items(actions).filter((i) => i.label === 'View licences')).toHaveLength(1)
        expect(submenu('File', actions).some((i) => i.label === 'View licences')).toBe(false)
      })
    }
  )

  it('on darwin there is no extra About Tide item (the app menu has role about)', () => {
    withPlatform('darwin', () => {
      const all = items()
      expect(all.find((i) => i.label === 'About Tide')).toBeUndefined()
      expect(all.some((i) => i.role === 'about')).toBe(true)
    })
  })
})
