import { test, expect, _electron as electron } from '@playwright/test'

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
  tideTest: { ttsLoad(): Promise<{ loadMs: number }> }
}
test('window opens titled Tide', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, TIDE_E2E: '1' }
  })
  const win = await app.firstWindow()
  await expect(win).toHaveTitle('Tide')
  await expect(win.getByText('Tide')).toBeVisible()
  await app.close()
})

test('speaks one sentence offline', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, TIDE_E2E: '1', TIDE_OFFLINE_GUARD: '1' }
  })
  const win = await app.firstWindow()
  const { loadMs } = await win.evaluate(() => (window as unknown as TideWindow).tideTest.ttsLoad())
  const r = await win.evaluate(() =>
    (window as unknown as TideWindow).tide.tts.synthesize(
      'Most adults can keep about four items in mind at once.',
      {
        voice: 'af_heart',
        speed: 1
      }
    )
  )
  expect(r.sampleRate).toBe(24000)
  expect(r.pcm.length).toBeGreaterThan(24000) // > 1 s of audio
  console.log(JSON.stringify({ loadMs, synthMs: r.synthMs, audioSec: r.pcm.length / 24000 }))
  await app.close()
})
