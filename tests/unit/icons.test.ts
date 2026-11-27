import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
// SHA-256 of the stock Electron atom icon that shipped as build/icon.png before the real mark.
const ELECTRON_PLACEHOLDER_SHA256 =
  '4363016ccf3541c84ae6a1eee83f507fb2b775aa89b9d6c8163875640267f9e9'

describe('app icons', () => {
  it('build/icon.png is 1024x1024 and is not the Electron placeholder', () => {
    const png = readFileSync(join(root, 'build', 'icon.png'))
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    expect(createHash('sha256').update(png).digest('hex')).not.toBe(ELECTRON_PLACEHOLDER_SHA256)
  })

  it('build/icon.ico holds 16, 32, 48 and 256 px entries', () => {
    const ico = readFileSync(join(root, 'build', 'icon.ico'))
    const count = ico.readUInt16LE(4)
    const sizes = new Set<number>()
    for (let i = 0; i < count; i++) sizes.add(ico[6 + i * 16] || 256)
    for (const s of [16, 32, 48, 256]) expect(sizes.has(s)).toBe(true)
  })

  it('build/icon.icns exists and is non-empty', () => {
    expect(statSync(join(root, 'build', 'icon.icns')).size).toBeGreaterThan(0)
  })

  it('build/icon.icns starts with the icns magic bytes', () => {
    const icns = readFileSync(join(root, 'build', 'icon.icns'))
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
  })

  it('resources/icon.png is 512x512 and matches a fresh render of build/icon.svg', () => {
    const png = readFileSync(join(root, 'resources', 'icon.png'))
    expect(png.readUInt32BE(16)).toBe(512)
    expect(png.readUInt32BE(20)).toBe(512)
    const svg = readFileSync(join(root, 'build', 'icon.svg'))
    const fresh = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng()
    expect(createHash('sha256').update(png).digest('hex')).toBe(
      createHash('sha256').update(fresh).digest('hex')
    )
  })
})
