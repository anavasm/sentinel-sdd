import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigView } from './ConfigView';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found - cannot mount mfe-config standalone.');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ConfigView />
    </BrowserRouter>
  </StrictMode>,
);
