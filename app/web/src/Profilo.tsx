/** Where Vanessa finds her own data: account, personal details, contract,
 *  pay parameters, and what build she is holding.
 *
 *  It loads its own data instead of receiving it from `App`. The profile and
 *  the quota would otherwise be the only reason `App` knows about either,
 *  and the quota changes during the day: a screen that reads when it opens
 *  shows the count of now, one handed the startup state shows this morning's.
 *
 *  All visible text stays in Italian: Vanessa reads it.
 */

import { useEffect, useState } from 'react';

import type { Profile } from '@vanessa/core';
import { CONTRACT_KINDS, EMPTY_PROFILE, MAX_READINGS_PER_DAY } from '@vanessa/core';

import type { Api, ConfigSnapshot } from './api.js';
import { claimsOf } from './claims.js';
import { sessioneValida, urlRegistrazionePasskey } from './auth.js';
import { PAY_FIELDS } from './payFields.js';

export interface ProfiloProps {
  api: Api;
  onClose: () => void;
}

const TESTO: { key: keyof Profile; label: string }[] = [
  { key: 'firstName', label: 'Nome' },
  { key: 'lastName', label: 'Cognome' },
  { key: 'employer', label: 'Datore di lavoro' },
];

const CONTRATTO: { key: keyof Profile; label: string }[] = [
  { key: 'ccnlLevel', label: 'Livello CCNL' },
  { key: 'jobTitle', label: 'Qualifica' },
  { key: 'workplace', label: 'Sede' },
  { key: 'ward', label: 'Reparto' },
];

const mostra = (v: number | null, isPercentage: boolean): string =>
  v == null ? '–' : isPercentage ? `${Math.round(v * 10000) / 100}` : String(v);

export function Profilo({ api, onClose }: ProfiloProps) {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Senza configurazione di accesso il link non si puo' costruire: si nasconde
  // invece di mostrarne uno rotto. E' lo stesso stato in cui l'app non
  // entrerebbe affatto, quindi in pratica non si vede mai.
  let linkPasskey: string | null = null;
  try {
    linkPasskey = urlRegistrazionePasskey();
  } catch {
    linkPasskey = null;
  }

  // Cognito rimanda qui con `?result=invalid_session` quando la pagina delle
  // passkey non accetta la sessione — succede se il cookie e' scaduto fra
  // l'apertura dell'app e il tocco sul link. Senza questa riga il ritorno e'
  // muto e sembra che il link non abbia fatto niente.
  const sessioneRifiutataDaCognito =
    new URLSearchParams(location.search).get('result') === 'invalid_session';

  useEffect(() => {
    let alive = true;
    api
      .config()
      .then((c) => {
        if (!alive) return;
        setSnapshot(c);
        setProfile(c.profile);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [api]);

  const sessione = sessioneValida();
  const email = claimsOf(sessione?.idToken).email;

  const scrivi = (key: keyof Profile, value: string | number | null) =>
    setProfile((p) => ({ ...p, [key]: value === '' ? null : value }));

  const salva = () => {
    setSaving(true);
    setError(null);
    api
      .saveProfile(profile)
      // What she typed stays in the fields: the write is single and
      // repeatable, so the same button is the way out.
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <section className="profilo">
      <div className="profilo-head">
        <button type="button" onClick={onClose}>
          Indietro
        </button>
        <h2>Profilo</h2>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {sessioneRifiutataDaCognito && (
        <p className="error" role="alert">
          La sessione non è stata accettata: il Face ID non è stato aggiunto. Riprova dal link
          qui sotto.
        </p>
      )}

      <h3>Account</h3>
      <dl>
        <dt>Email</dt>
        <dd>{email ?? '–'}</dd>
        <dt>Sessione valida fino a</dt>
        <dd>
          {sessione
            ? new Date(sessione.scade).toLocaleString('it-IT', {
                dateStyle: 'short',
                timeStyle: 'short',
              })
            : '–'}
        </dd>
      </dl>

      {/* Un link e non un pulsante: porta fuori dall'app, sulla pagina di
          Cognito, e il tasto indietro deve funzionare come su un link. */}
      {linkPasskey && (
        <p className="note">
          <a href={linkPasskey}>Aggiungi Face ID su questo telefono</a>
          <br />
          Va rifatto su ogni telefono: la passkey resta su quello dove è stata creata. Finché
          non c'è, si entra sempre col codice via email.
        </p>
      )}

      <h3>Dati personali</h3>
      <div className="settings">
        {TESTO.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="text"
              value={(profile[key] as string | null) ?? ''}
              onChange={(e) => scrivi(key, e.target.value)}
            />
          </label>
        ))}
        <label>
          <span>Data di assunzione</span>
          <input
            type="date"
            value={profile.hiredOn ?? ''}
            onChange={(e) => scrivi('hiredOn', e.target.value)}
          />
        </label>
      </div>

      <h3>Contratto</h3>
      <div className="settings">
        <label>
          <span>Tipo di contratto</span>
          <select
            value={profile.contractKind ?? ''}
            onChange={(e) => scrivi('contractKind', e.target.value)}
          >
            <option value="">–</option>
            {CONTRACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Ore settimanali</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={profile.weeklyHours ?? ''}
            onChange={(e) =>
              scrivi('weeklyHours', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </label>
        {CONTRATTO.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="text"
              value={(profile[key] as string | null) ?? ''}
              onChange={(e) => scrivi(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <p className="note">
        Le ore settimanali sono qui per essere lette: nessun conteggio dell'app le usa.
      </p>

      <button type="button" className="primary" disabled={saving} onClick={salva}>
        Salva
      </button>

      <h3>Retribuzione</h3>
      <p className="note">
        Questi valori si modificano in <strong>Stipendio</strong>, dove stanno accanto alla
        simulazione che li usa. Qui rispondono a una domanda sola: con che tariffa sta
        calcolando, dato il livello qui sopra.
      </p>
      <dl>
        {PAY_FIELDS.map(({ key, label, isPercentage }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{snapshot ? mostra(snapshot.pay[key], isPercentage) : '–'}</dd>
          </div>
        ))}
      </dl>

      <h3>App</h3>
      <dl>
        <dt>Versione</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt>Letture della foto oggi</dt>
        <dd>
          {snapshot ? `${snapshot.quota.used} di ${MAX_READINGS_PER_DAY}` : '–'}
        </dd>
      </dl>
    </section>
  );
}
