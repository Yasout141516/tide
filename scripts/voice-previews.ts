/**
 * Renders the bundled voice previews: PREVIEW_SENTENCE in each of the ten voices, fp32, speed 1,
 * encoded to mono 64 kbps MP3 with the bundled ffmpeg.
 *
 *   npm run fetch-model && npm run voice-previews:render
 *
 * Writes src/renderer/public/voice-previews/<voice>.mp3. Plain Node via tsx, offline.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { concatPcm, SAMPLE_RATE, toS16le } from '../src/shared/pcm'
import { PREVIEW_SENTENCE, VOICES } from '../src/shared/voices'
import { ffmpegBaseArgs, ffmpegPath, pcmInputArgs } from '../src/main/export/ffmpeg'
import { blockNetwork, configureOffline, MODEL_ID, speechChunks } from '../src/tts/engine'

const ROOT = resolve(__dirname, '..')
const OUT_DIR = join(ROOT, 'src', 'renderer', 'public', 'voice-previews')
const run = promisify(execFile)

blockNetwork()

async function encodeMp3(pcm: Float32Array, outPath: string): Promise<void> {
  const raw = join(OUT_DIR, '.tmp.s16le')
  writeFileSync(raw, toS16le(pcm))
  await run(
    ffmpegPath(),
    [...ffmpegBaseArgs, ...pcmInputArgs(raw), '-ac', '1', '-b:a', '64k', outPath],
    { windowsHide: true }
  )
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  await configureOffline(join(ROOT, 'resources', 'models'))
  const { KokoroTTS } = await import('kokoro-js')
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'cpu' })
  for (const v of VOICES) {
    const voice = v.id as NonNullable<Parameters<typeof tts.generate>[1]>['voice']
    const parts: Float32Array[] = []
    for (const chunk of await speechChunks(PREVIEW_SENTENCE)) {
      parts.push((await tts.generate(chunk, { voice, speed: 1 })).audio)
    }
    const pcm = concatPcm(parts)
    await encodeMp3(pcm, join(OUT_DIR, `${v.id}.mp3`))
    const sec = pcm.length / SAMPLE_RATE
    // Copy charsPerSec into VOICES (src/shared/voices.ts).
    process.stderr.write(
      `${v.id}.mp3: ${sec.toFixed(1)} s, charsPerSec ${(PREVIEW_SENTENCE.length / sec).toFixed(1)}\n`
    )
  }
  rmSync(join(OUT_DIR, '.tmp.s16le'), { force: true })
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
