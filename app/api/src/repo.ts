/** Accesso a DynamoDB. L'unico posto che conosce la forma della tabella. */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import type { Codice, IsoDate, Paga } from '@vanessa/core';
import { PAGA_VUOTA, parseIso } from '@vanessa/core';

export interface Turno {
  data: IsoDate;
  cod: Codice;
  codOrig?: Codice | null;
  collega?: string | null;
  tipoScambio?: string | null;
  note?: string | null;
}

export const CONFIG_PK = 'CONFIG';
export const CONFIG_SK = 'PAGA';

export function turniPk(anno: number): string {
  return `TURNI#${anno}`;
}

export interface Repo {
  turniTra(da: IsoDate, a: IsoDate): Promise<Turno[]>;
  salvaTurno(t: Turno): Promise<void>;
  cancellaTurno(data: IsoDate): Promise<void>;
  leggiPaga(): Promise<Paga>;
  salvaPaga(p: Paga): Promise<void>;
}

/** Un intervallo puo' attraversare il capodanno: una query per anno. */
function anniCoperti(da: IsoDate, a: IsoDate): number[] {
  const primo = parseIso(da).anno;
  const ultimo = parseIso(a).anno;
  const out: number[] = [];
  for (let y = primo; y <= ultimo; y++) out.push(y);
  return out;
}

export function creaRepo(tabella: string, client?: DynamoDBDocumentClient): Repo {
  const doc = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async turniTra(da, a) {
      const turni: Turno[] = [];
      for (const anno of anniCoperti(da, a)) {
        let esclusivo: Record<string, unknown> | undefined;
        do {
          const r = await doc.send(
            new QueryCommand({
              TableName: tabella,
              KeyConditionExpression: 'pk = :pk AND sk BETWEEN :da AND :a',
              ExpressionAttributeValues: { ':pk': turniPk(anno), ':da': da, ':a': a },
              ExclusiveStartKey: esclusivo,
            }),
          );
          for (const item of r.Items ?? []) {
            turni.push({
              data: item.sk as IsoDate,
              cod: item.cod as Codice,
              codOrig: (item.codOrig as Codice | undefined) ?? null,
              collega: (item.collega as string | undefined) ?? null,
              tipoScambio: (item.tipoScambio as string | undefined) ?? null,
              note: (item.note as string | undefined) ?? null,
            });
          }
          esclusivo = r.LastEvaluatedKey;
        } while (esclusivo);
      }
      turni.sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
      return turni;
    },

    async salvaTurno(t) {
      const { anno } = parseIso(t.data);
      await doc.send(
        new PutCommand({
          TableName: tabella,
          Item: {
            pk: turniPk(anno),
            sk: t.data,
            cod: t.cod,
            ...(t.codOrig ? { codOrig: t.codOrig } : {}),
            ...(t.collega ? { collega: t.collega } : {}),
            ...(t.tipoScambio ? { tipoScambio: t.tipoScambio } : {}),
            ...(t.note ? { note: t.note } : {}),
          },
        }),
      );
    },

    async cancellaTurno(data) {
      const { anno } = parseIso(data);
      await doc.send(
        new DeleteCommand({ TableName: tabella, Key: { pk: turniPk(anno), sk: data } }),
      );
    },

    async leggiPaga() {
      const r = await doc.send(
        new GetCommand({ TableName: tabella, Key: { pk: CONFIG_PK, sk: CONFIG_SK } }),
      );
      if (!r.Item) return PAGA_VUOTA;
      const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
      return {
        tariffaOraria: num(r.Item.tariffaOraria),
        maggSabato: num(r.Item.maggSabato),
        maggDomenica: num(r.Item.maggDomenica),
        maggFestivo: num(r.Item.maggFestivo),
        rateo13a: num(r.Item.rateo13a),
        coeffNetto: num(r.Item.coeffNetto),
      };
    },

    async salvaPaga(p) {
      await doc.send(
        new PutCommand({
          TableName: tabella,
          Item: { pk: CONFIG_PK, sk: CONFIG_SK, ...p },
        }),
      );
    },
  };
}
