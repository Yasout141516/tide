import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Runtime modules that must never be bundled: kokoro-js reads voices relative to its own
// files, onnxruntime-node and ffmpeg-static ship native binaries. They are asarUnpack'ed.
const runtimeExternals = [
  'kokoro-js',
  '@huggingface/transformers',
  'onnxruntime-node',
  'phonemizer',
  'ffmpeg-static'
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'tts-worker': resolve('src/tts/worker.ts')
        },
        external: runtimeExternals
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // Never inline @fontsource files as data: URIs; the CSP font-src then falls back to self.
    build: { assetsInlineLimit: 0 },
    plugins: [react(), tailwindcss()]
  }
})
