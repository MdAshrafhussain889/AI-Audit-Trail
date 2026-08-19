import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './AuthContext'

// Global animation transition defaults to match the glassmorphic theme
const defaultTransition = {
  type: 'spring'as const,
  stiffness: 300,
  damping: 30,
  restDelta: 0.001
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      MotionConfig ensures that all Framer Motion animations globally
      respect the user's OS-level reduced motion preferences.
    */}
    <MotionConfig reducedMotion="user" transition={defaultTransition}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </MotionConfig>
  </StrictMode>,
)
