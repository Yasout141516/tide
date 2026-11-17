// TEMPORARY (spike M0d diagnosis): writes 2-chapter .m4b variants to test-results/variants/
// so CI's macOS job can see which ffmpeg muxer settings AVFoundation reads chapters from.
import { spawnSync } from 'child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static')
const dir = 'test-results/variants'
mkdirSync(dir, { recursive: true })

const sr = 24000
const pcm = new Int16Array(sr * 6).map((_, i) => Math.round(0.2 * Math.sin(i / 10) * 32767))
const meta = join(dir, 'meta.txt')
writeFileSync(
  meta,
  ';FFMETADATA1\ntitle=Variant\nalbum=Variant\nartist=Tide\n\n' +
    '[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=Page 1\n\n' +
    '[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=6000\ntitle=Page 2\n'
)

function enc(name, outArgs) {
  const out = join(dir, name)
  const args = ['-v', 'error', '-y', '-f', 's16le', '-ar', String(sr), '-ac', '1', '-i', 'pipe:0']
  args.push('-i', meta, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1')
  args.push('-c:a', 'aac', '-b:a', '64k', ...outArgs, out)
  const r = spawnSync(ffmpeg, args, { input: Buffer.from(pcm.buffer) })
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr}`)
  return out
}

/** Set the chapter (text) track's mdhd language to packed ISO-639-2 'eng'. */
function patchChapterLang(file, out) {
  const d = readFileSync(file)
  let at = d.indexOf('mdhd')
  while (at >= 0) {
    const hdlr = d.indexOf('hdlr', at)
    if (d.toString('latin1', hdlr + 12, hdlr + 16) === 'text') d.writeUInt16BE(0x15c7, at + 4 + 20)
    at = d.indexOf('mdhd', at + 4)
  }
  writeFileSync(out, d)
}

const ipodFs = enc('ipod_fs.m4b', ['-movflags', '+faststart', '-f', 'ipod'])
enc('ipod_nofs.m4b', ['-f', 'ipod'])
enc('mp4_fs.m4b', ['-movflags', '+faststart', '-f', 'mp4'])
enc('mov_fs.m4b', ['-movflags', '+faststart', '-f', 'mov'])
enc('ipod_fs_audlang.m4b', ['-metadata:s:a:0', 'language=eng', '-movflags', '+faststart', '-f', 'ipod'])
patchChapterLang(ipodFs, join(dir, 'ipod_fs_chaplang.m4b'))
copyFileSync(ipodFs, join(dir, 'ipod_fs.m4a'))
const brand = readFileSync(ipodFs)
brand.write('M4B ', 8, 'latin1')
writeFileSync(join(dir, 'ipod_fs_brand.m4b'), brand)
console.log('variants written to', dir)
