import { execFileSync } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { test, expect } from '@playwright/test'
import { ffmpegPath } from '../../src/main/audio-export'
import { launchTide } from './launch'

// The preload bridge as seen from the page (see src/preload/index.d.ts).
type TideWindow = {
  tide: {
    tts: {
      synthesize(
        text: string,
        o: { voice: string; speed: number }
      ): Promise<{ pcm: Float32Array; sampleRate: number; synthMs: number }>
    }
  }
  tideTest: {
    ttsLoad(): Promise<{ loadMs: number }>
    exportM4b(
      outPath: string
    ): Promise<{ audioSec: number; chapters: number; exportMs: number; ffmpegHasMp3: boolean }>
  }
}

// CI's macOS job checks this file's chapters with AVFoundation (scripts/check-chapters.swift).
const resultsDir = resolve(__dirname, '..', '..', 'test-results')
const smokeM4b = resolve(resultsDir, 'smoke.m4b')

test('window opens titled Tide', async () => {
  const app = await launchTide()
  const win = await app.firstWindow()
  await expect(win).toHaveTitle('Tide')
  await expect(win.getByText('Tide')).toBeVisible()
  await app.close()
})

test('speaks one sentence offline', async () => {
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  const { loadMs } = await win.evaluate(() => (window as unknown as TideWindow).tideTest.ttsLoad())
  const speak = (): Promise<{ pcm: Float32Array; sampleRate: number; synthMs: number }> =>
    win.evaluate(() =>
      (window as unknown as TideWindow).tide.tts.synthesize(
        'Most adults can keep about four items in mind at once.',
        { voice: 'af_heart', speed: 1 }
      )
    )
  const r = await speak()
  expect(r.sampleRate).toBe(24000)
  expect(r.pcm.length).toBeGreaterThan(24000) // > 1 s of audio
  // synthMs is the first (cold) synthesis; warmSynthMs repeats it, as during steady playback.
  const warm = await speak()
  const metrics = JSON.stringify({
    loadMs,
    synthMs: r.synthMs,
    audioSec: r.pcm.length / 24000,
    warmSynthMs: warm.synthMs
  })
  console.log(metrics)
  // CI reads this file to put load time and real-time factor in the job summary.
  if (process.env.TIDE_METRICS_FILE) appendFileSync(process.env.TIDE_METRICS_FILE, metrics + '\n')
  await app.close()
})

test('exports a 2-chapter m4b audiobook', async () => {
  rmSync(smokeM4b, { force: true })
  mkdirSync(resultsDir, { recursive: true })
  const app = await launchTide({ TIDE_OFFLINE_GUARD: '1' })
  const win = await app.firstWindow()
  const r = await win.evaluate(
    (out) => (window as unknown as TideWindow).tideTest.exportM4b(out),
    smokeM4b
  )
  await app.close()
  expect(r.chapters).toBe(2)
  expect(existsSync(smokeM4b)).toBe(true)
  expect(existsSync(smokeM4b + '.part')).toBe(false)
  // Cross-check with ffmpeg itself (AVFoundation is checked separately on macOS CI).
  const meta = execFileSync(
    ffmpegPath(),
    ['-v', 'error', '-i', smokeM4b, '-f', 'ffmetadata', '-'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }
  )
  expect(meta.match(/\[CHAPTER\]/g)).toHaveLength(2)
  expect(meta).toContain('title=Page 2')
  const metrics = JSON.stringify(r)
  console.log(metrics)
  // CI puts ffmpegHasMp3 and the export time in the job summary.
  writeFileSync(resolve(resultsDir, 'smoke-export.json'), metrics + '\n')
})
