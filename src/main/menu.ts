import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../shared/ipc-types'

/** The application menu. Shortcuts work on Windows too, where the menu bar stays hidden until Alt. */
export function buildMenu(send: (c: AppCommand) => void, about: () => void = () => {}): Menu {
  const mac = process.platform === 'darwin'
  const mod = mac ? '⌘' : 'Ctrl+'
  const minus = mac ? '−' : '-'
  const settingsItem: MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => send({ type: 'settings' })
  }
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? ([
          {
            label: 'Tide',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Add reading…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send({ type: 'add-reading' })
        },
        ...(mac
          ? []
          : ([
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'quit' }
            ] as MenuItemConstructorOptions[]))
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Larger text',
          accelerator: 'CmdOrCtrl+=',
          click: () => send({ type: 'zoom', step: 1 })
        },
        // The same command on the Plus key, for keyboards where "+" needs Shift.
        {
          label: 'Larger text',
          accelerator: 'CmdOrCtrl+Plus',
          visible: false,
          click: () => send({ type: 'zoom', step: 1 })
        },
        {
          label: 'Smaller text',
          accelerator: 'CmdOrCtrl+-',
          click: () => send({ type: 'zoom', step: -1 })
        }
      ]
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: `${mod}O  Add reading`, enabled: false },
        { label: `${mod}+ / ${mod}${minus}  Text size`, enabled: false },
        { label: `${mod},  Settings`, enabled: false },
        { label: '← / →  Previous / next sentence', enabled: false },
        ...(mac
          ? []
          : ([
              { type: 'separator' },
              { label: 'About Tide', click: () => about() }
            ] as MenuItemConstructorOptions[]))
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}
