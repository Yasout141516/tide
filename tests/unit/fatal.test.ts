import { describe, expect, it, vi } from 'vitest'
import { createFatalHandler } from '../../src/main/startup'

describe('fatal handler', () => {
  it('before any window: logs, shows a plain error once and exits 1', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const showError = vi.fn()
    const exit = vi.fn()
    const h = createFatalHandler({ hasWindow: () => false, showError, exit })
    h('uncaught exception', new Error('boom'))
    h('unhandled rejection', new Error('again'))
    expect(showError).toHaveBeenCalledTimes(1)
    expect(showError).toHaveBeenCalledWith(
      'Tide could not start',
      'Something went wrong while starting Tide. Please quit and open it again.'
    )
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('exits even if the dialog throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.fn()
    const h = createFatalHandler({
      hasWindow: () => false,
      showError: () => {
        throw new Error('no dialog')
      },
      exit
    })
    expect(() => h('x', 'y')).toThrow()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('once a window exists: only logs', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const showError = vi.fn()
    const exit = vi.fn()
    createFatalHandler({ hasWindow: () => true, showError, exit })('x', 'y')
    expect(showError).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })
})
