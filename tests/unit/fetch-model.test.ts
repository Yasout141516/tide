import { it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'; import { tmpdir } from 'node:os'
import { verifySha256 } from '../../scripts/fetch-model.mjs'
it('accepts a matching hash and rejects a wrong one', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tide-')), 'a.bin'); writeFileSync(f, 'abc')
  await expect(verifySha256(f, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).resolves.toBeUndefined()
  await expect(verifySha256(f, '00'.repeat(32))).rejects.toThrow('sha256 mismatch')
})
