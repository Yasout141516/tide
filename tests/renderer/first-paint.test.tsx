// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeTide } from './setup'

describe('first paint', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
    delete (window as { tide?: unknown }).tide
    document.body.innerHTML = ''
    vi.resetModules()
  })

  it('main applies the main-provided initial theme synchronously, before React commits', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    document.documentElement.dataset.theme = 'sky-sea'
    ;(window as { tide?: unknown }).tide = fakeTide({ initialTheme: 'deep-sea' })
    await import('../../src/renderer/src/main')
    // No act(): React has not rendered yet, so this can only be main.tsx's own write.
    expect(document.documentElement.dataset.theme).toBe('deep-sea')
  })

  it('main still starts when window.tide is missing', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    document.documentElement.dataset.theme = 'sky-sea'
    await import('../../src/renderer/src/main')
    expect(document.documentElement.dataset.theme).toBe('sky-sea')
  })
})
