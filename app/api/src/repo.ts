/** DynamoDB access. The only place that knows the table's shape. */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import type { IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS, parseIso } from '@vanessa/core';

export interface ShiftRecord {
  date: IsoDate;
  code: ShiftCode;
  originalCode?: ShiftCode | null;
  colleague?: string | null;
  swapKind?: string | null;
  notes?: string | null;
}

export const CONFIG_PK = 'CONFIG';
export const CONFIG_SK = 'PAY';

export function shiftsPk(year: number): string {
  return `SHIFTS#${year}`;
}

export interface Repo {
  shiftsBetween(from: IsoDate, to: IsoDate): Promise<ShiftRecord[]>;
  saveShift(s: ShiftRecord): Promise<void>;
  deleteShift(date: IsoDate): Promise<void>;
  readPaySettings(): Promise<PaySettings>;
  savePaySettings(p: PaySettings): Promise<void>;
}

/** A range can cross new year: one query per year. */
function yearsCovered(from: IsoDate, to: IsoDate): number[] {
  const first = parseIso(from).year;
  const last = parseIso(to).year;
  const out: number[] = [];
  for (let y = first; y <= last; y++) out.push(y);
  return out;
}

export function createRepo(table: string, client?: DynamoDBDocumentClient): Repo {
  const doc = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async shiftsBetween(from, to) {
      const shifts: ShiftRecord[] = [];
      for (const year of yearsCovered(from, to)) {
        let exclusiveStartKey: Record<string, unknown> | undefined;
        do {
          const r = await doc.send(
            new QueryCommand({
              TableName: table,
              KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
              ExpressionAttributeValues: { ':pk': shiftsPk(year), ':from': from, ':to': to },
              ExclusiveStartKey: exclusiveStartKey,
            }),
          );
          for (const item of r.Items ?? []) {
            shifts.push({
              date: item.sk as IsoDate,
              code: item.code as ShiftCode,
              originalCode: (item.originalCode as ShiftCode | undefined) ?? null,
              colleague: (item.colleague as string | undefined) ?? null,
              swapKind: (item.swapKind as string | undefined) ?? null,
              notes: (item.notes as string | undefined) ?? null,
            });
          }
          exclusiveStartKey = r.LastEvaluatedKey;
        } while (exclusiveStartKey);
      }
      shifts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return shifts;
    },

    async saveShift(s) {
      const { year } = parseIso(s.date);
      await doc.send(
        new PutCommand({
          TableName: table,
          Item: {
            pk: shiftsPk(year),
            sk: s.date,
            code: s.code,
            ...(s.originalCode ? { originalCode: s.originalCode } : {}),
            ...(s.colleague ? { colleague: s.colleague } : {}),
            ...(s.swapKind ? { swapKind: s.swapKind } : {}),
            ...(s.notes ? { notes: s.notes } : {}),
          },
        }),
      );
    },

    async deleteShift(date) {
      const { year } = parseIso(date);
      await doc.send(
        new DeleteCommand({ TableName: table, Key: { pk: shiftsPk(year), sk: date } }),
      );
    },

    async readPaySettings() {
      const r = await doc.send(
        new GetCommand({ TableName: table, Key: { pk: CONFIG_PK, sk: CONFIG_SK } }),
      );
      if (!r.Item) return EMPTY_PAY_SETTINGS;
      const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
      return {
        hourlyRate: num(r.Item.hourlyRate),
        saturdayPremium: num(r.Item.saturdayPremium),
        sundayPremium: num(r.Item.sundayPremium),
        holidayPremium: num(r.Item.holidayPremium),
        thirteenthAccrual: num(r.Item.thirteenthAccrual),
        netRatio: num(r.Item.netRatio),
      };
    },

    async savePaySettings(p) {
      await doc.send(
        new PutCommand({
          TableName: table,
          Item: { pk: CONFIG_PK, sk: CONFIG_SK, ...p },
        }),
      );
    },
  };
}
