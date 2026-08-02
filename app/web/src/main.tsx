import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { completaAccesso, iniziaAccesso, rinnovaAccesso, sessioneValida } from './auth.js';
import './styles.css';

const radice = document.getElementById('root');
if (!radice) throw new Error('elemento #root mancante');

// Niente si disegna prima che ci sia una sessione: una schermata a metà, con
// i dati che non arrivano perché l'API risponde 401, è peggio di un redirect
// che lei non nota nemmeno.
const avvia = async () => {
  try {
    try {
      await completaAccesso();
    } catch {
      // A dropped connection or a non-JSON body during the token exchange —
      // a phone that changed cell tower on the way back from Cognito is the
      // ordinary case here, not the exotic one. Treat it exactly like no
      // code was ever there, and let the check below send her to a fresh
      // login instead of leaving #root blank forever.
    }
    // The ID token lives an hour; the refresh token lives the day the pool
    // was configured for. Try it before deciding there is no session, so the
    // ordinary case — she opens the app hours in, still the same day — is a
    // silent renewal, not a redirect back out to Cognito.
    const s = sessioneValida() ?? (await rinnovaAccesso());
    if (s) {
      createRoot(radice).render(
        <StrictMode>
          <App sessione={s} />
        </StrictMode>,
      );
      return;
    }
    await iniziaAccesso();
  } catch (e) {
    // Only the belt-and-braces guard in auth.ts reaches here (a build that
    // shipped without the pool configured) — the network-drop case above is
    // already handled. #root must not stay blank either way: a blank screen
    // gives her nothing to act on.
    radice.textContent = e instanceof Error ? e.message : 'Accesso non riuscito.';
  }
};
void avvia();
