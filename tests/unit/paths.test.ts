import { describe, it, expect } from 'vitest'
import { unpackedPath } from '../../src/main/paths'
describe('unpackedPath', () => {
  it('rewrites app.asar to app.asar.unpacked', () => {
    expect(unpackedPath('/A/Tide.app/Contents/Resources/app.asar/node_modules/x'))
      .toBe('/A/Tide.app/Contents/Resources/app.asar.unpacked/node_modules/x')
  })
  it('leaves non-asar paths alone', () => {
    expect(unpackedPath('C:\\dev\\tide\\node_modules\\x')).toBe('C:\\dev\\tide\\node_modules\\x')
  })
})