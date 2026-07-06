import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { configureAxiosAuth } from './auth/tokenStore.ts'

// React oluşturulmadan önce interceptor'lar kurulur; ilk API isteği de otomatik refresh kullanabilir.
configureAxiosAuth()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
