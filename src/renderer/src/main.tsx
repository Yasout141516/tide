import '@fontsource/nunito-sans/latin-400.css'
import '@fontsource/nunito-sans/latin-600.css'
import '@fontsource/nunito-sans/latin-700.css'
import '@fontsource/nunito-sans/latin-800.css'
import '@fontsource/fraunces/latin-700.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installPdfProbe } from './reader/probe'

// Test-only (TIDE_E2E=1 exposes window.tideTest): lets Playwright prove pdf.js works under the CSP.
if (window.tideTest) installPdfProbe()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
