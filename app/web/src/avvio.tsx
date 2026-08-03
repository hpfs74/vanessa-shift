/** Il cancello: decide se si disegna qualcosa, e cosa si dice quando no.
 *
 * Sta qui e non in `main.tsx` perché è l'unico punto in cui un errore di
 * accesso può diventare una frase invece di un altro giro di Face ID, e
 * `main.tsx` non lo può importare nessun test: gira appena viene letto.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import {
  AccessoInterrotto,
  AccessoNonCompletato,
  ErroreDaMostrare,
  accessoInterrotto,
  completaAccesso,
  giriDiAccesso,
  iniziaAccesso,
  rinnovaAccesso,
  sessioneValida,
} from './auth.js';

// Niente si disegna prima che ci sia una sessione: una schermata a metà, con
// i dati che non arrivano perché l'API risponde 401, è peggio di un redirect
// che lei non nota nemmeno.
export const avvia = async (radice: HTMLElement): Promise<void> => {
  try {
    try {
      await completaAccesso();
    } catch (e) {
      // A dropped connection or a non-JSON body during the token exchange —
      // a phone that changed cell tower on the way back from Cognito is the
      // ordinary case here, not the exotic one. Treat it exactly like no
      // code was ever there, and let the check below send her to a fresh
      // login instead of leaving #root blank forever.
      //
      // Not so when Cognito told us why it refused: that is not a hiccup, it
      // is an answer, and it will be the same answer next time round.
      if (e instanceof ErroreDaMostrare) throw e;
      // Swallowed, but not silently. When this is not a lost connection but a
      // CORS refusal from the token endpoint, this is the only place the real
      // cause exists — the redirect counter below can say that signing in
      // does not complete, and nothing anywhere can say why.
      console.error("scambio del codice non riuscito all'accesso:", e);
    }
    // The ID token lives an hour; the refresh token lives the day the pool
    // was configured for. Try it before deciding there is no session, so the
    // ordinary case — she opens the app hours in, still the same day — is a
    // silent renewal, not a redirect back out to Cognito.
    const s = sessioneValida() ?? (await rinnovaAccesso());
    if (s) {
      createRoot(radice).render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      return;
    }
    // The breaker in auth.ts has already been all the way round in this tab:
    // signed in, renewed, refused again. Another `iniziaAccesso()` here is
    // the same lap once more, and she would get Face ID every few seconds
    // with nothing on the screen to explain it. A 401 that a fresh token
    // does not cure is not about her session — see `sessioneRifiutata`.
    if (accessoInterrotto()) {
      throw new AccessoInterrotto(
        "L'accesso riesce ma il servizio rifiuta comunque le richieste. " +
          "Non è qualcosa che puoi sistemare tu: chiudi la pagina e riprova più tardi.",
      );
    }
    // The other way of never getting anywhere, and the one no 401 ever
    // reports: we sent her to Cognito, Cognito sent her back with a code, and
    // the code did not become a session. `completaAccesso` has already zeroed
    // this counter for every other way of arriving here — a bare URL, a fresh
    // visit, the back button — so a non-zero value has exactly one meaning,
    // and another trip would only cost her another Face ID. Checked after the
    // breaker because the breaker implies a sign-in that *did* work, which
    // zeroes this.
    if (giriDiAccesso() >= 1) {
      throw new AccessoNonCompletato(
        "Non riesco a completare l'accesso: la pagina di accesso ti rimanda qui, " +
          'ma la sessione non si crea. È un problema di configurazione ' +
          "dell'app, non qualcosa che hai sbagliato tu — chi l'ha messa in " +
          'piedi trova il motivo nella console del browser.',
      );
    }
    await iniziaAccesso();
  } catch (e) {
    // The errors auth.ts writes for her already name the cause and are safe
    // to show as they are. Anything else reaching this catch is unexpected —
    // a `TypeError`, say — and its `.message` is an internal, English detail,
    // not something to put on her screen wholesale: log it for whoever
    // debugs this, and show a fixed Italian sentence instead. Either way
    // #root must not stay blank: a blank screen gives her nothing to act on.
    if (e instanceof ErroreDaMostrare) {
      radice.textContent = e.message;
    } else {
      console.error(e);
      radice.textContent = "Qualcosa e' andato storto all'avvio. Ricarica la pagina.";
    }
  }
};
