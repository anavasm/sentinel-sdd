import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MetricsView } from './MetricsView';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found — cannot mount mfe-metrics standalone.');
}

createRoot(rootElement).render(
  <StrictMode>
    <MetricsView />
  </StrictMode>,
);
