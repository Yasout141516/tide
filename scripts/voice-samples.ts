/**
 * Renders a short sample (the first 3 sentences of one page) in every candidate voice, at q8 and
 * fp32, so the voices can be compared by ear.
 *
 *   npm run fetch-model -- --dtype all     (once; downloads the fp32 model too)
 *   npm run voice-samples -- <file.pdf> [--page N]
 *
 * Writes local-fixtures/voice-samples/<voice>-<dtype>.wav (16-bit PCM, 24 kHz mono) and an
 * index.html with one <audio controls> per file, grouped by voice. Plain Node via tsx, offline.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractPages } from '../src/shared/text/extract'
import { buildSentences } from '../src/shared/text/pipeline'
import { concatPcm, SAMPLE_RATE, toS16le } from '../src/shared/pcm'
import { blockNetwork, configureOffline, MODEL_ID, speechChunks } from '../src/tts/engine'

const VOICES = [
  'af_heart',
  'af_bella',
  'af_nicole',
  'af_sarah',
  'af_kore',
  'bf_emma',
  'bf_isabella',
  'am_michael',
  'am_fenrir',
  'am_puck',
  'bm_george',
  'bm_fable'
]
const DTYPES = ['q8', 'fp32'] as const
type Dtype = (typeof DTYPES)[number]
const SENTENCES = 3
const GAP_SECONDS = 0.25
const ROOT = resolve(__dirname, '..')
const OUT_DIR = join(ROOT, 'local-fixtures', 'voice-samples')

// Same as the worker: any hidden download fails loudly.
blockNetwork()

/** Writes 16-bit PCM mono WAV. */
function writeWav(path: string, pcm: Float32Array, sampleRate: number): void {
  const data = toS16le(pcm)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([h, data]))
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface Row {
  voice: string
  dtype: Dtype
  file: string
  seconds: number
  synthSeconds: number
}

function writeIndex(pdfName: string, page: number, count: number, rows: Row[]): void {
  const cells = (voice: string): string =>
    DTYPES.map((d) => {
      const r = rows.find((x) => x.voice === voice && x.dtype === d)
      if (!r) return `<td>${d}: not rendered</td>`
      const rtf = (r.synthSeconds / r.seconds).toFixed(2)
      return (
        `<td><div class="dtype">${d}</div>` +
        `<audio controls preload="none" src="${r.file}"></audio>` +
        `<div class="meta">${r.seconds.toFixed(1)} s audio, ${r.synthSeconds.toFixed(1)} s to synthesize (RTF ${rtf})</div></td>`
      )
    }).join('')
  const body = VOICES.map((v) => `<tr><th>${v}</th>${cells(v)}</tr>`).join('\n')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tide voice samples</title>
<style>
body{font:15px system-ui,sans-serif;margin:24px;max-width:960px}
table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}
th{width:110px;font-family:monospace}
.dtype{font-weight:600}
.meta{color:#555;font-size:12px}
audio{width:100%}
</style></head><body>
<h1>Tide voice samples</h1>
<p>Source: ${esc(pdfName)}, page ${page}. Each clip is the same ${count} sentences. q8 and fp32 sit side by side.</p>
<table>
<tr><th>Voice</th><th>q8 (default)</th><th>fp32</th></tr>
${body}
</table>
</body></html>
`
  writeFileSync(join(OUT_DIR, 'index.html'), html)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const pi = args.indexOf('--page')
  const pageArg = pi >= 0 ? Number(args[pi + 1]) : undefined
  const files = args.filter((a, i) => !a.startsWith('--') && (pi < 0 || i !== pi + 1))
  if (files.length !== 1 || (pageArg !== undefined && !Number.isInteger(pageArg))) {
    process.stderr.write('usage: npm run voice-samples -- <file.pdf> [--page N]\n')
    process.exit(2)
  }

  const pages = await extractPages(readFileSync(files[0]))
  const { sentences } = buildSentences(pages)
  const byPage = new Map<number, string[]>()
  for (const s of sentences) {
    const p = s.spans[0].page
    byPage.set(p, [...(byPage.get(p) ?? []), s.text])
  }
  const page =
    pageArg ??
    [...byPage.keys()].sort((a, b) => a - b).find((p) => (byPage.get(p) ?? []).length >= SENTENCES)
  const pageSentences = page === undefined ? undefined : byPage.get(page)
  if (page === undefined || !pageSentences || pageSentences.length === 0) {
    throw new Error(
      pageArg !== undefined
        ? `page ${pageArg} has no sentences`
        : `no page with at least ${SENTENCES} sentences`
    )
  }
  const sample = pageSentences.slice(0, SENTENCES)
  process.stderr.write(`using ${files[0]} page ${page}, ${sample.length} sentences\n`)

  mkdirSync(OUT_DIR, { recursive: true })
  await configureOffline(join(ROOT, 'resources', 'models'))
  const { KokoroTTS } = await import('kokoro-js')

  const pdfName = files[0].split(/[\\/]/).pop() ?? files[0]
  const rows: Row[] = []
  const gap = new Float32Array(Math.round(GAP_SECONDS * SAMPLE_RATE))
  const t00 = performance.now()
  for (const dtype of DTYPES) {
    const tl = performance.now()
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype, device: 'cpu' })
    process.stderr.write(`loaded ${dtype} in ${((performance.now() - tl) / 1000).toFixed(1)} s\n`)
    for (const v of VOICES) {
      const voice = v as NonNullable<Parameters<typeof tts.generate>[1]>['voice']
      const t0 = performance.now()
      const parts: Float32Array[] = []
      for (const sentence of sample) {
        for (const chunk of await speechChunks(sentence)) {
          parts.push((await tts.generate(chunk, { voice, speed: 1 })).audio)
        }
        parts.push(gap)
      }
      parts.pop() // no trailing silence
      const pcm = concatPcm(parts)
      const synthSeconds = (performance.now() - t0) / 1000
      const file = `${v}-${dtype}.wav`
      writeWav(join(OUT_DIR, file), pcm, SAMPLE_RATE)
      const seconds = pcm.length / SAMPLE_RATE
      rows.push({ voice: v, dtype, file, seconds, synthSeconds })
      process.stderr.write(
        `${file}: ${seconds.toFixed(1)} s audio, synth ${synthSeconds.toFixed(1)} s (RTF ${(synthSeconds / seconds).toFixed(2)})\n`
      )
      writeIndex(pdfName, page, sample.length, rows)
    }
  }
  process.stderr.write(
    `wrote ${rows.length} files + index.html to ${OUT_DIR} in ${((performance.now() - t00) / 1000).toFixed(0)} s\n`
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
