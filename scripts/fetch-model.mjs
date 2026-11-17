import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  renameSync,
  rmSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(here, 'model-manifest.json'), 'utf8'))
/** Per-file download limit (the fp32 model is about 325 MB), so a stalled download fails CI. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export async function verifySha256(filePath, expectedHex) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  if (hash.digest('hex') !== expectedHex.toLowerCase()) {
    throw new Error(`sha256 mismatch for ${filePath}`)
  }
}

async function verifyFile(file, path) {
  if (statSync(path).size !== file.size) throw new Error(`size mismatch for ${path}`)
  if (file.sha256) await verifySha256(path, file.sha256)
  else if (file.path.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'))
}

async function isUpToDate(file, path) {
  if (!existsSync(path)) return false
  try {
    await verifyFile(file, path)
    return true
  } catch {
    return false
  }
}

export async function fetchModel({
  dtype = 'q8',
  root = resolve(here, '..', 'resources', 'models')
} = {}) {
  if (!['q8', 'fp32', 'all'].includes(dtype)) throw new Error(`unknown --dtype ${dtype}`)
  const wanted = manifest.files.filter(
    (f) => f.dtype === 'base' || dtype === 'all' || f.dtype === dtype
  )
  const base = join(root, ...manifest.repo.split('/'))
  for (const file of wanted) {
    const dest = join(base, file.path)
    if (await isUpToDate(file, dest)) {
      console.log(`up to date: ${file.path}`)
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    const url = `https://huggingface.co/${manifest.repo}/resolve/${manifest.revision}/${file.path}`
    console.log(`downloading ${file.path} (${file.size} bytes)`)
    // The signal covers the body stream too: a download still running after the limit is aborted.
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    const part = `${dest}.part`
    try {
      const res = await fetch(url, { redirect: 'follow', signal })
      if (!res.ok || !res.body)
        throw new Error(`download failed for ${file.path}: HTTP ${res.status}`)
      await pipeline(Readable.fromWeb(res.body), createWriteStream(part), { signal })
      await verifyFile(file, part)
    } catch (err) {
      rmSync(part, { force: true })
      if (err?.name === 'TimeoutError')
        throw new Error(
          `download of ${file.path} timed out after ${DOWNLOAD_TIMEOUT_MS / 60000} min`,
          { cause: err }
        )
      throw err
    }
    renameSync(part, dest)
    console.log(`done: ${file.path}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--dtype')
  const dtype = i >= 0 ? process.argv[i + 1] : 'q8'
  fetchModel({ dtype }).catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
