import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './stile.css';

const radice = document.getElementById('root');
if (!radice) throw new Error('elemento #root mancante');
createRoot(radice).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
