import { resolve, sep } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Runtime modules that must never be bundled: kokoro-js reads voices relative to its own
// files, onnxruntime-node and ffmpeg-static ship native binaries. They are asarUnpack'ed.
const runtimeExternals = [
  'kokoro-js',
  '@huggingface/transformers',
  'onnxruntime-node',
  'phonemizer',
  'ffmpeg-static'
]

// Absolute, forward-slash glob for vite-plugin-static-copy (a Windows backslash path is not a glob).
const pdfjs = (sub: string): string => resolve('node_modules/pdfjs-dist', sub).split(sep).join('/')

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
    // The text pipeline worker is an ES module worker (it imports shared code).
    worker: { format: 'es' },
    plugins: [
      react(),
      tailwindcss(),
      // pdf.js's cMaps, standard fonts, ICC profiles and wasm decoders ship with the app and load
      // same-origin (no network). quickjs-* is left out: Tide never runs PDF JavaScript.
      viteStaticCopy({
        targets: [
          { src: pdfjs('cmaps/*'), dest: 'pdfjs/cmaps', rename: { stripBase: true } },
          {
            src: pdfjs('standard_fonts/*'),
            dest: 'pdfjs/standard_fonts',
            rename: { stripBase: true }
          },
          { src: pdfjs('iccs/*'), dest: 'pdfjs/iccs', rename: { stripBase: true } },
          {
            src: [
              'openjpeg.wasm',
              'jbig2.wasm',
              'qcms_bg.wasm',
              'openjpeg_nowasm_fallback.js',
              'jbig2_nowasm_fallback.js',
              'LICENSE_*'
            ].map((f) => pdfjs(`wasm/${f}`)),
            dest: 'pdfjs/wasm',
            rename: { stripBase: true }
          }
        ]
      })
    ]
  }
})
