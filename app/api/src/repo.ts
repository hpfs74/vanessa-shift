/** DynamoDB access. The only place that knows the table's shape. */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { IsoDate, PaySettings, Profile, ShiftCode } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS, EMPTY_PROFILE, isContractKind, isIsoDate, parseIso } from '@vanessa/core';

export interface ShiftRecord {
  date: IsoDate;
  code: ShiftCode;
  /** Hours actually worked, when they differed from the shift's own. */
  hoursOverride?: number | null;
  originalCode?: ShiftCode | null;
  colleague?: string | null;
  swapKind?: string | null;
  notes?: string | null;
}

export const CONFIG_PK = 'CONFIG';
export const CONFIG_SK = 'PAY';

/** The profile lives beside the pay settings, on its own row. Two rows is
 *  what lets one PUT write either without reading the other: a whole-item
 *  Put of the pay settings cannot lose a surname, and the reverse cannot
 *  zero an hourly rate. */
export const PROFILE_SK = 'PROFILE';

/** The counter of photo readings, one row per day. */
export const QUOTA_PK = 'QUOTA#FOTO';

/** How long a count row survives past its day. Two days are enough to cover
 *  any timezone and keep the table clean. */
const QUOTA_TTL_DAYS = 2;

export function shiftsPk(year: number): string {
  return `SHIFTS#${year}`;
}

export interface Repo {
  shiftsBetween(from: IsoDate, to: IsoDate): Promise<ShiftRecord[]>;
  saveShift(s: ShiftRecord): Promise<void>;
  deleteShift(date: IsoDate): Promise<void>;
  /** Writes many days at once. Used by the bulk-entry screen. */
  saveShifts(shifts: readonly ShiftRecord[]): Promise<void>;
  readPaySettings(): Promise<PaySettings>;
  savePaySettings(p: PaySettings): Promise<void>;
  readProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  /** Consumes a photo reading for that day. `false` if the cap has already
   *  been reached. The condition and the increment are the same operation:
   *  two simultaneous requests at the boundary must not both go through. */
  consumePhotoQuota(date: IsoDate, max: number): Promise<boolean>;
  /** How many photo readings today has already spent. */
  readPhotoQuota(date: IsoDate): Promise<number>;
}

/** DynamoDB writes at most 25 items per BatchWrite call. */
export const BATCH_LIMIT = 25;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A range can cross new year: one query per year. */
function yearsCovered(from: IsoDate, to: IsoDate): number[] {
  const first = parseIso(from).year;
  const last = parseIso(to).year;
  const out: number[] = [];
  for (let y = first; y <= last; y++) out.push(y);
  return out;
}

/** One day's item. Absent optional fields are left out rather than stored
 *  as null: an attribute that is not there reads unambiguously as "not set". */
function itemOf(s: ShiftRecord): Record<string, unknown> {
  const { year } = parseIso(s.date);
  return {
    pk: shiftsPk(year),
    sk: s.date,
    code: s.code,
    // Zero is a real override: check for null, not for falsiness.
    ...(s.hoursOverride == null ? {} : { hoursOverride: s.hoursOverride }),
    ...(s.originalCode ? { originalCode: s.originalCode } : {}),
    ...(s.colleague ? { colleague: s.colleague } : {}),
    ...(s.swapKind ? { swapKind: s.swapKind } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
  };
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
              hoursOverride:
                typeof item.hoursOverride === 'number' ? item.hoursOverride : null,
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
      await doc.send(new PutCommand({ TableName: table, Item: itemOf(s) }));
    },

    async saveShifts(shifts) {
      // BatchWrite can return unprocessed items under load: retrying them is
      // the difference between "a month was saved" and "most of a month was".
      for (const group of chunk(shifts, BATCH_LIMIT)) {
        let pending = group.map((s) => ({ PutRequest: { Item: itemOf(s) } }));
        for (let attempt = 0; pending.length > 0 && attempt < 5; attempt++) {
          const r = await doc.send(
            new BatchWriteCommand({ RequestItems: { [table]: pending } }),
          );
          pending = (r.UnprocessedItems?.[table] ?? []) as typeof pending;
        }
        if (pending.length > 0) {
          throw new Error(`${pending.length} giorni non salvati, riprova`);
        }
      }
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

    async readProfile() {
      const r = await doc.send(
        new GetCommand({ TableName: table, Key: { pk: CONFIG_PK, sk: PROFILE_SK } }),
      );
      if (!r.Item) return EMPTY_PROFILE;
      const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
      return {
        firstName: text(r.Item.firstName),
        lastName: text(r.Item.lastName),
        employer: text(r.Item.employer),
        hiredOn: isIsoDate(r.Item.hiredOn) ? r.Item.hiredOn : null,
        contractKind: isContractKind(r.Item.contractKind) ? r.Item.contractKind : null,
        ccnlLevel: text(r.Item.ccnlLevel),
        jobTitle: text(r.Item.jobTitle),
        weeklyHours: typeof r.Item.weeklyHours === 'number' ? r.Item.weeklyHours : null,
        workplace: text(r.Item.workplace),
        ward: text(r.Item.ward),
      };
    },

    async saveProfile(p) {
      // Absent fields are left out rather than written as null, as `itemOf`
      // does for a shift. Zero is a real answer and must survive: test for
      // null, not for falsiness.
      const item: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(p)) {
        if (value != null) item[field] = value;
      }
      // Assigned after the loop, not seeded before it: a field named `pk` or
      // `sk` could otherwise overwrite the key `Object.entries` iterates over.
      item.pk = CONFIG_PK;
      item.sk = PROFILE_SK;
      await doc.send(new PutCommand({ TableName: table, Item: item }));
    },

    async consumePhotoQuota(date, max) {
      const { year, month, day } = parseIso(date);
      const expires = Math.floor(Date.UTC(year, month - 1, day + QUOTA_TTL_DAYS) / 1000);
      try {
        await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: QUOTA_PK, sk: date },
            // `count` is a DynamoDB reserved word: unescaped, the whole call is
            // rejected with a ValidationException before the item is touched.
            // The alias keeps the stored attribute name as it is. `expires` is
            // not reserved and needs no alias.
            UpdateExpression: 'SET expires = :expires ADD #count :one',
            ConditionExpression: 'attribute_not_exists(#count) OR #count < :max',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: { ':one': 1, ':max': max, ':expires': expires },
          }),
        );
        return true;
      } catch (e) {
        // The failed condition is a response, not a fault: the cap has been
        // reached. Any other error must propagate.
        if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },

    async readPhotoQuota(date) {
      const r = await doc.send(
        new GetCommand({ TableName: table, Key: { pk: QUOTA_PK, sk: date } }),
      );
      // No row means no reading yet today, which is the normal morning case.
      return typeof r.Item?.count === 'number' ? r.Item.count : 0;
    },
  };
}
