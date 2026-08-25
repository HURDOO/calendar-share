import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { consumeShareToken } from './public/share-token'
import './styles.css'

const root = document.querySelector<HTMLDivElement>('#root')

if (!root) {
  throw new Error('Root element was not found')
}

const initialShareToken = consumeShareToken()

createRoot(root).render(
  <StrictMode>
    <App initialShareToken={initialShareToken} />
  </StrictMode>,
)
