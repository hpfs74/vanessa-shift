/** I quattro handler Lambda. Il repo si inietta per poterli testare senza rete. */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import type { Repo } from './repo.js';
import { creaRepo } from './repo.js';
import {
  esigiCodice,
  esigiData,
  esigiIntervallo,
  esigiPaga,
  gestisci,
  ok,
  parseJson,
  testoOpzionale,
} from './http.js';

function repoDaAmbiente(): Repo {
  const tabella = process.env.TABELLA;
  if (!tabella) throw new Error('variabile di ambiente TABELLA non impostata');
  return creaRepo(tabella);
}

export function getShiftsCon(repo: Repo) {
  return (evento: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    gestisci(async () => {
      const q = evento.queryStringParameters ?? {};
      const { da, a } = esigiIntervallo(q.from, q.to);
      return ok({ turni: await repo.turniTra(da, a) });
    });
}

export function putShiftCon(repo: Repo) {
  return (evento: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    gestisci(async () => {
      const data = esigiData(evento.pathParameters?.date, 'date');
      const b = parseJson(evento.body);

      // Un codice vuoto cancella il giorno: l'assenza e' l'assenza,
      // non un item con dentro il nulla.
      if (b.cod === null || b.cod === undefined || b.cod === '') {
        await repo.cancellaTurno(data);
        return ok({ data, cancellato: true });
      }

      const turno = {
        data,
        cod: esigiCodice(b.cod),
        codOrig: b.codOrig === null || b.codOrig === undefined || b.codOrig === ''
          ? null
          : esigiCodice(b.codOrig),
        collega: testoOpzionale(b.collega, 'collega'),
        tipoScambio: testoOpzionale(b.tipoScambio, 'tipoScambio', 40),
        note: testoOpzionale(b.note, 'note', 500),
      };
      await repo.salvaTurno(turno);
      return ok({ turno });
    });
}

export function getConfigCon(repo: Repo) {
  // L'evento non serve, ma la firma resta uniforme alle altre rotte.
  return (_evento?: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    gestisci(async () => ok({ paga: await repo.leggiPaga() }));
}

export function putConfigCon(repo: Repo) {
  return (evento: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    gestisci(async () => {
      const paga = esigiPaga(parseJson(evento.body));
      await repo.salvaPaga(paga);
      return ok({ paga });
    });
}

// Entry point delle Lambda in produzione.
export const getShifts = (e: APIGatewayProxyEventV2) => getShiftsCon(repoDaAmbiente())(e);
export const putShift = (e: APIGatewayProxyEventV2) => putShiftCon(repoDaAmbiente())(e);
export const getConfig = (e: APIGatewayProxyEventV2) => getConfigCon(repoDaAmbiente())(e);
export const putConfig = (e: APIGatewayProxyEventV2) => putConfigCon(repoDaAmbiente())(e);
