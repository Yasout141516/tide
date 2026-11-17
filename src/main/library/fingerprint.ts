import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

const SAMPLE_BYTES = 262144

/** `"<size>:<sha256 hex of bytes 0..min(size, 256 KB))>"`. Cheap enough for big PDFs, stable across moves. */
export async function fingerprint(path: string): Promise<string> {
  const { size } = await stat(path)
  const hash = createHash('sha256')
  const length = Math.min(size, SAMPLE_BYTES)
  if (length > 0) {
    const stream = createReadStream(path, { start: 0, end: length - 1 })
    for await (const chunk of stream) hash.update(chunk as Buffer)
  }
  return `${size}:${hash.digest('hex')}`
}
