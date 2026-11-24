import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLog, createRendererGate, diagnosticInfo, logError, setLog } from '../../src/main/log'
import type { LibrarySettings } from '../../src/shared/library/types'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'tide-log-'))

afterEach(() => {
  vi.restoreAllMocks()
  setLog(null)
})

describe('log', () => {
  it('appends with time and scope and replaces the home dir with <path>', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    const log = createLog(dir, { home: 'C:\\Users\\Mia' })
    log.error('library', new Error('cannot open C:\\Users\\Mia\\Docs\\a.pdf for C:\\Users\\Mia'))
    const text = readFileSync(join(dir, 'tide.log'), 'utf8')
    expect(text).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[library\] cannot open <path>\n/)
    expect(text).not.toContain('Mia')
    expect(text).toContain('at ')
  })

  it('rotates to tide.1.log past maxBytes, keeping one old file', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    const log = createLog(dir, { maxBytes: 300, home: '/nowhere' })
    log.error('a', 'first ' + 'x'.repeat(150))
    log.error('b', 'second ' + 'y'.repeat(150))
    log.error('c', 'third ' + 'z'.repeat(150))
    expect(readFileSync(join(dir, 'tide.1.log'), 'utf8')).toContain('second')
    const cur = readFileSync(join(dir, 'tide.log'), 'utf8')
    expect(cur).toContain('third')
    expect(cur).not.toContain('second')
    expect(existsSync(join(dir, 'tide.2.log'))).toBe(false)
  })

  it('never throws when the folder cannot be written', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    const blocker = join(dir, 'file')
    writeFileSync(blocker, 'x')
    const log = createLog(join(blocker, 'logs'))
    expect(() => log.error('x', new Error('boom'))).not.toThrow()
    expect(spy).toHaveBeenCalled()
  })

  it('logError is console-only until a log is set, then writes to it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => logError('early', new Error('e'))).not.toThrow()
    const dir = tmp()
    setLog(createLog(dir))
    logError('late', new Error('hello'))
    expect(readFileSync(join(dir, 'tide.log'), 'utf8')).toContain('[late] hello')
  })

  it('diagnostics lists the pronunciation count but not the words', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    const log = createLog(dir)
    log.error('x', 'something broke')
    const settings = {
      reading: { skipCitations: true },
      zoom: 1,
      voice: 'v',
      speed: 1,
      theme: 'deep-sea',
      darkPages: true,
      pronunciations: [
        { id: '1', from: 'Nguyen', say: 'win' },
        { id: '2', from: 'Siobhan', say: 'shivawn' }
      ]
    } as unknown as LibrarySettings
    const info = diagnosticInfo({
      appVersion: '1.2.3',
      electron: '45.0.0',
      os: 'win32',
      osRelease: '10.0',
      arch: 'x64',
      voice: 'ready',
      settings
    })
    const text = await log.diagnostics(info)
    expect(text).toContain('Tide: 1.2.3')
    expect(text).toContain('Voice engine: ready')
    expect(text).toContain('Pronunciation fixes: 2')
    expect(text).toContain('Theme: deep-sea')
    expect(text).toContain('something broke')
    expect(text).not.toMatch(/Nguyen|Siobhan|shivawn/)
  })
})

describe('path scrubbing', () => {
  function written(home: string, message: string): string {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    createLog(dir, { home }).error('x', message)
    return readFileSync(join(dir, 'tide.log'), 'utf8')
  }

  it('replaces a path on another drive with <path>', () => {
    const t = written('C:\\Users\\Mia', 'ENOENT D:\\Lectures\\Smith.pdf missing')
    expect(t).toContain('ENOENT <path>\n')
    expect(t).not.toContain('Smith')
  })

  it('replaces a UNC path', () => {
    const t = written('C:\\Users\\Mia', 'cannot read \\\\nas\\share\\Course\\Jones.pdf now')
    expect(t).toContain('cannot read <path>\n')
    expect(t).not.toMatch(/Jones|nas/)
  })

  it('replaces a JSON-escaped path', () => {
    const t = written('C:\\Users\\Mia', JSON.stringify({ path: 'D:\\Lectures\\Smith.pdf' }))
    expect(t).toContain('{"path":"<path>"}')
    expect(t).not.toContain('Smith')
  })

  it('replaces an absolute POSIX path but keeps URLs and lone slashes', () => {
    const t = written('/home/mia', 'open /Volumes/usb/Smith.pdf and http://a/b and a/b')
    expect(t).toContain('open <path>\n')
    expect(written('/home/mia', 'a /Smith.pdf')).toContain('a <path>\n')
    expect(written('/home/mia', 'x "/Smith.pdf" c')).toContain('x "<path>" c')
    const u = written('/home/mia', 'see http://a/b and a/b and 1/2')
    expect(u).toContain('see http://a/b and a/b and 1/2')
  })

  it('matches the home dir in a different case', () => {
    const t = written('C:\\Users\\Mia', 'c:\\users\\MIA\\Docs\\a.pdf')
    expect(t).toMatch(/\[x\] <path>\n/)
    expect(t).not.toMatch(/Docs|MIA/)
  })

  it('does not turn C:\\Users\\Mia2 into ~2', () => {
    const t = written('C:\\Users\\Mia', 'C:\\Users\\Mia2\\x.pdf')
    expect(t).not.toContain('~')
    expect(t).toContain('<path>')
  })

  it('takes a spaced path inside quotes whole', () => {
    const t = written('C:\\Users\\Mia', 'failed "D:\\My Readings\\Week 3 Social Class.pdf" twice')
    expect(t).toContain('failed "<path>" twice')
    expect(t).not.toMatch(/Readings|Social/)
  })

  it('takes a spaced path with no quotes to the end of the line', () => {
    const t = written('C:\\Users\\Mia', 'cannot open D:\\My Readings\\Week 3 Social Class.pdf')
    expect(t).toContain('cannot open <path>\n')
    expect(t).not.toMatch(/Readings|Social/)
  })

  it('takes parentheses in a file name', () => {
    const t = written('C:\\Users\\Mia', 'bad D:\\Notes (final).pdf')
    expect(t).toContain('bad <path>\n')
    expect(t).not.toContain('final')
  })

  it('scrubs a stack frame with a spaced path, keeping the function name', () => {
    const t = written(
      'C:\\Users\\Mia',
      'boom\n    at f (C:\\Program Files\\Tide\\resources\\app.asar\\out\\main\\index.js:12:3)'
    )
    expect(t).toContain('    at f (<path>)')
    expect(t).not.toMatch(/Program|asar/)
  })

  it('scrubs a home path with spaces and a file:/// url', () => {
    const t = written('C:\\Users\\Mia Smith', 'a C:\\Users\\Mia Smith\\Docs\\a.pdf')
    expect(t).toContain('a <path>\n')
    expect(t).not.toMatch(/Smith|Docs/)
    expect(written('/home/mia', 'x file:///C:/My Docs/a.pdf')).toContain('x <path>\n')
  })

  it('leaves a URL alone', () => {
    const t = written('C:\\Users\\Mia', 'GET https://example.com/a/b?x=1 failed')
    expect(t).toContain('GET https://example.com/a/b?x=1 failed')
  })
})

describe('renderer gate', () => {
  it('collapses identical consecutive messages into a repeat count', () => {
    const log = { error: vi.fn() }
    const g = createRendererGate(log)
    g.push('boom')
    g.push('boom')
    g.push('boom')
    g.push('other')
    expect(log.error.mock.calls.map((c) => c[1])).toEqual([
      'boom',
      '(previous message repeated 2 times)',
      'other'
    ])
  })

  it('flush writes a pending repeat count', () => {
    const log = { error: vi.fn() }
    const g = createRendererGate(log)
    g.push('a')
    g.push('a')
    g.flush()
    expect(log.error).toHaveBeenLastCalledWith('renderer', '(previous message repeated 1 times)')
  })

  it('keeps at most 20 entries a minute, then resumes', () => {
    const log = { error: vi.fn() }
    let t = 0
    const g = createRendererGate(log, { now: () => t })
    for (let i = 0; i < 50; i++) g.push(`m${i}`)
    expect(log.error).toHaveBeenCalledTimes(20)
    t = 60_000
    g.push('later')
    expect(log.error).toHaveBeenCalledTimes(21)
  })

  it('counts repeat summaries against the budget (pairs of identical messages)', () => {
    const log = { error: vi.fn() }
    const g = createRendererGate(log, { now: () => 0 })
    for (let i = 0; i < 100; i++) {
      g.push(`m${i}`)
      g.push(`m${i}`)
      g.push(`m${i}`)
    }
    g.flush()
    expect(log.error.mock.calls.length).toBeLessThanOrEqual(20)
    expect(log.error.mock.calls.length).toBe(20)
  })

  it('caps an alternating A/B loop at 20 writes a minute', () => {
    const log = { error: vi.fn() }
    const g = createRendererGate(log, { now: () => 0 })
    for (let i = 0; i < 200; i++) g.push(i % 2 ? 'A' : 'B')
    g.flush()
    expect(log.error.mock.calls.length).toBe(20)
  })

  it('drops a repeat summary when the budget is spent', () => {
    const log = { error: vi.fn() }
    const g = createRendererGate(log, { now: () => 0, max: 1 })
    g.push('a')
    g.push('a')
    g.flush()
    expect(log.error).toHaveBeenCalledTimes(1)
  })
})
