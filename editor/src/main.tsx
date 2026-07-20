import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SchemaProvider } from './schema';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SchemaProvider>
      <App />
    </SchemaProvider>
  </StrictMode>,
);
