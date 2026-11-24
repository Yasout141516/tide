/**
 * Measures how long a live job waits for its first audio while an export sentence is synthesizing,
 * with and without the worker's between-chunks priority (R35). Plain Node via tsx, offline, real fp32 model.
 *
 *   npx tsx scripts/measure-live-during-export.ts [runs]
 *
 * The text is invented. "before" is the old behaviour (preempt: false), "after" the current scheduler.
 */
import { join, resolve } from 'node:path'
import { concatPcm, SAMPLE_RATE } from '../src/shared/pcm'
import {
  blockNetwork,
  chunkLimit,
  configureOffline,
  MODEL_ID,
  speechChunks
} from '../src/tts/engine'
import { JobQueue } from '../src/tts/queue'
import { createPump, type SynthJobLike } from '../src/tts/scheduler'
import type { TtsResponse } from '../src/tts/protocol'

blockNetwork()
const ROOT = resolve(__dirname, '..')
const RUNS = Number(process.argv[2] ?? 3)

// One long export sentence: a reference-list style run of invented clauses, several chunks long.
const clause = (i: number): string =>
  `the committee reviewed proposal number ${i} on tidal energy storage and filed its notes`
const LONG = Array.from({ length: 40 }, (_, i) => clause(i)).join(', ') + '.'
const LIVE_TEXT = 'The harbour was quiet that morning, and the boats rocked gently.'

async function main(): Promise<void> {
  await configureOffline(join(ROOT, 'resources', 'models'))
  const { KokoroTTS } = await import('kokoro-js')
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'cpu' })
  type Voice = NonNullable<Parameters<typeof tts.generate>[1]>['voice']
  await tts.generate('Ready.', { voice: 'af_heart' as Voice, speed: 1 })
  await speechChunks('Ready in 1984, OK.', 120)
  const exportChunks = (await speechChunks(LONG, chunkLimit('export'))).length
  process.stderr.write(`export sentence: ${LONG.length} chars, ${exportChunks} chunks\n`)

  async function once(preempt: boolean): Promise<{ liveMs: number; exportMs: number }> {
    const queue = new JobQueue<SynthJobLike>()
    const t: Record<string, number> = {}
    let t0 = 0
    const pump = createPump<SynthJobLike>({
      queue,
      chunks: speechChunks,
      chunkLimit,
      generate: async (c, v, s) => (await tts.generate(c, { voice: v as Voice, speed: s })).audio,
      isLoaded: () => true,
      isCancelled: () => false,
      reply: (r: TtsResponse) => {
        if (r.type === 'audio') t[String(r.id)] = performance.now()
      },
      yieldToMessages: () => new Promise((r) => setImmediate(r)),
      concat: concatPcm,
      sampleRate: SAMPLE_RATE,
      now: () => performance.now(),
      preempt
    })
    const mk = (id: number, text: string, priority: 'live' | 'export'): SynthJobLike => ({
      id, text, voice: 'af_heart', speed: 1, priority, gen: `g${id}`
    }) // prettier-ignore
    t0 = performance.now()
    queue.push(mk(1, LONG, 'export'))
    const running = pump()
    // The live job arrives once the first export chunk is under way.
    await new Promise((r) => setTimeout(r, 400))
    const liveAt = performance.now()
    queue.push(mk(2, LIVE_TEXT, 'live'))
    void pump()
    await running
    return { liveMs: t['2'] - liveAt, exportMs: t['1'] - t0 }
  }

  const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  for (const preempt of [false, true]) {
    const rs: { liveMs: number; exportMs: number }[] = []
    for (let i = 0; i < RUNS; i++) rs.push(await once(preempt))
    process.stdout.write(
      `${preempt ? 'after (preempt)' : 'before (no preempt)'}: live first-clip ${rs
        .map((r) => Math.round(r.liveMs))
        .join(
          ', '
        )} ms (median ${Math.round(median(rs.map((r) => r.liveMs)))} ms); export sentence done in ${Math.round(median(rs.map((r) => r.exportMs)))} ms\n`
    )
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
