import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { completaAccesso, iniziaAccesso, sessioneValida } from './auth.js';
import './styles.css';

const radice = document.getElementById('root');
if (!radice) throw new Error('elemento #root mancante');

// Niente si disegna prima che ci sia una sessione: una schermata a metà, con
// i dati che non arrivano perché l'API risponde 401, è peggio di un redirect
// che lei non nota nemmeno.
const avvia = async () => {
  await completaAccesso();
  const s = sessioneValida();
  if (!s) {
    await iniziaAccesso();
    return;
  }
  createRoot(radice).render(
    <StrictMode>
      <App sessione={s} />
    </StrictMode>,
  );
};
void avvia();
