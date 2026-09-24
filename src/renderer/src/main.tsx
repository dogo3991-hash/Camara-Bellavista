import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { MiniPreview } from './MiniPreview'

const isMini = window.location.hash === '#mini'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{isMini ? <MiniPreview /> : <App />}</React.StrictMode>
)
