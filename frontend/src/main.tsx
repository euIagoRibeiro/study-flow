import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import SessionGate from './components/SessionGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionGate render={(onLogout) => <App onLogout={onLogout} />} />
    </BrowserRouter>
  </StrictMode>,
)
