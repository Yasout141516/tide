import { readFileSync } from 'fs'
import { resolve } from 'path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string> }
const wf = load(
  readFileSync(resolve(__dirname, '../../.github/workflows/release.yml'), 'utf8')
) as { on: Record<string, unknown>; jobs: Record<string, Job> }

describe('release workflow', () => {
  it('triggers on v* tags and manual dispatch', () => {
    expect(wf.on).toHaveProperty('workflow_dispatch')
    expect((wf.on.push as { tags: string[] }).tags).toEqual(['v*'])
  })
  it('creates the draft once, before the matrix, on tag runs only', () => {
    const jobs = wf.jobs
    expect(Object.keys(jobs)).toEqual(
      expect.arrayContaining([
        'ffmpeg-source-fetch',
        'create-draft',
        'release',
        'ffmpeg-source-attach'
      ])
    )
    expect(jobs['create-draft'].needs).toBe('ffmpeg-source-fetch')
    expect(jobs['create-draft'].if).toBe("github.ref_type == 'tag'")
    expect(jobs['create-draft'].permissions).toEqual({ contents: 'write' })
    expect(jobs['release'].needs).toEqual(['ffmpeg-source-fetch', 'create-draft'])
  })
  it('the release condition runs on tags (draft made) and dispatch (draft skipped), not after a failure', () => {
    const cond = wf.jobs['release'].if as string
    expect(cond).toMatch(/^always\(\) &&/)
    const evalCond = (fetch: string, draft: string): boolean =>
      new Function(
        'always',
        'needs',
        `return ${cond.replace(/needs\.ffmpeg-source-fetch/g, "needs['ffmpeg-source-fetch']").replace(/needs\.create-draft/g, "needs['create-draft']")}`
      )(() => true, {
        'ffmpeg-source-fetch': { result: fetch },
        'create-draft': { result: draft }
      }) as boolean
    expect(evalCond('success', 'success')).toBe(true) // tag run
    expect(evalCond('success', 'skipped')).toBe(true) // dispatch run
    expect(evalCond('success', 'failure')).toBe(false)
    expect(evalCond('success', 'cancelled')).toBe(false)
    expect(evalCond('failure', 'skipped')).toBe(false)
    expect(evalCond('cancelled', 'skipped')).toBe(false)
  })
  it('the attach step fails on several matching releases and never splices the tag into jq', () => {
    const text = readFileSync(resolve(__dirname, '../../.github/workflows/release.yml'), 'utf8')
    expect(text).toContain('::error::More than one release matches tag')
    expect(text).not.toMatch(/'"\$GITHUB_REF_NAME"'/)
    expect(text).toContain('jq -r --arg t "$GITHUB_REF_NAME"')
  })
})
