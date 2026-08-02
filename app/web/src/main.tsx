import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import {
  ConfigurazioneMancante,
  completaAccesso,
  iniziaAccesso,
  rinnovaAccesso,
  sessioneValida,
} from './auth.js';
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
    // The belt-and-braces guard in auth.ts is expected here (a build that
    // shipped without the pool configured) and its message already names the
    // cause, safe to show as-is. Anything else reaching this catch is
    // unexpected — a `TypeError`, say — and its `.message` is an internal,
    // English detail, not something to put on her screen wholesale: log it
    // for whoever debugs this, and show a fixed Italian sentence instead.
    // Either way #root must not stay blank: a blank screen gives her nothing
    // to act on.
    if (e instanceof ConfigurazioneMancante) {
      radice.textContent = e.message;
    } else {
      console.error(e);
      radice.textContent = "Qualcosa e' andato storto all'avvio. Ricarica la pagina.";
    }
  }
};
void avvia();
