// Regenerates every app icon from build/icon.svg (the sun-and-wave mark on a macOS-style tile).
// Run: npm run icons. Previews (16/32/64/128 px) go to the git-ignored .superpowers/icon-previews/.
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as png2icons from 'png2icons'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'))

function render(size: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

const master = render(1024)
writeFileSync(join(root, 'build', 'icon.png'), master)
// The window icon keeps its existing 512 px size.
writeFileSync(join(root, 'resources', 'icon.png'), render(512))

const icns = png2icons.createICNS(master, png2icons.BICUBIC, 0)
if (!icns) throw new Error('ICNS generation failed')
writeFileSync(join(root, 'build', 'icon.icns'), icns)

// forWinExe=true embeds 16, 24, 32, 48, 64, 72, 96, 128 and 256 px entries.
const ico = png2icons.createICO(master, png2icons.BICUBIC, 0, false, true)
if (!ico) throw new Error('ICO generation failed')
writeFileSync(join(root, 'build', 'icon.ico'), ico)

const previews = join(root, '.superpowers', 'icon-previews')
mkdirSync(previews, { recursive: true })
for (const s of [16, 32, 64, 128]) writeFileSync(join(previews, `icon-${s}.png`), render(s))
console.log('icons written')
