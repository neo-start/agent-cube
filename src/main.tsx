import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { AgentConfigsProvider } from './hooks/useAgentConfigs'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgentConfigsProvider>
      <App />
    </AgentConfigsProvider>
  </React.StrictMode>,
)
