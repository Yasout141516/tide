import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_VOICE, VOICES, VOICE_IDS, speedLabel, voiceName } from '../../src/shared/voices'

const root = resolve(__dirname, '..', '..')

describe('voices', () => {
  it('VOICES lists exactly the ten chosen ids in order and DEFAULT_VOICE is bf_emma', () => {
    expect(VOICES.map((v) => v.id)).toEqual([
      'af_kore',
      'af_nicole',
      'af_sarah',
      'am_fenrir',
      'am_michael',
      'am_puck',
      'bf_emma',
      'bf_isabella',
      'bm_fable',
      'bm_george'
    ])
    expect(DEFAULT_VOICE).toBe('bf_emma')
    expect(VOICE_IDS.size).toBe(10)
  })

  it('names and speed labels', () => {
    expect(voiceName('bm_fable')).toBe('Fable')
    expect(voiceName('nope')).toBe('Emma')
    expect(speedLabel(1)).toBe('1×')
    expect(speedLabel(1.25)).toBe('1.25×')
    expect(speedLabel(0.8)).toBe('0.8×')
  })

  it('every voice has a bundled preview', () => {
    for (const v of VOICES) {
      const p = resolve(root, 'src/renderer/public/voice-previews', `${v.id}.mp3`)
      expect(existsSync(p), p).toBe(true)
      expect(statSync(p).size, p).toBeGreaterThan(5 * 1024)
    }
  })
})

describe('electron-builder.yml', () => {
  const yml = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8')

  it('prunes every voice that is not in VOICES', () => {
    const m = yml.match(/!node_modules\/kokoro-js\/voices\/!\(([^)]*)\)\.bin/)
    expect(m, 'pruning pattern').not.toBeNull()
    expect(new Set(m![1].split('|'))).toEqual(new Set(VOICE_IDS))
  })

  it('ships the fp32 model and not q8', () => {
    expect(yml).toContain('**/onnx/model.onnx')
    expect(yml).not.toContain('model_quantized')
  })
})
