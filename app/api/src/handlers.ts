/** The four Lambda handlers. The repo is injected so they test without a network. */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import type { Repo } from './repo.js';
import { createRepo } from './repo.js';
import {
  handle,
  ok,
  optionalText,
  parseJson,
  requireDate,
  requireHoursOverride,
  requirePaySettings,
  requireRange,
  requireShiftCode,
  requireShiftList,
  requireSwapKind,
} from './http.js';

function repoFromEnvironment(): Repo {
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error('environment variable TABLE_NAME is not set');
  return createRepo(table);
}

export function getShiftsWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      const q = event.queryStringParameters ?? {};
      const { from, to } = requireRange(q.from, q.to);
      return ok({ shifts: await repo.shiftsBetween(from, to) });
    });
}

export function putShiftWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      const date = requireDate(event.pathParameters?.date, 'date');
      const b = parseJson(event.body);

      // An empty code deletes the day: absence is absence, not an item
      // holding nothing.
      if (b.code === null || b.code === undefined || b.code === '') {
        await repo.deleteShift(date);
        return ok({ date, deleted: true });
      }

      const record = {
        date,
        code: requireShiftCode(b.code),
        hoursOverride: requireHoursOverride(b.hoursOverride),
        originalCode:
          b.originalCode === null || b.originalCode === undefined || b.originalCode === ''
            ? null
            : requireShiftCode(b.originalCode),
        colleague: optionalText(b.colleague, 'colleague'),
        swapKind: requireSwapKind(b.swapKind),
        notes: optionalText(b.notes, 'notes', 500),
      };
      await repo.saveShift(record);
      return ok({ shift: record });
    });
}

export function putShiftsWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      const shifts = requireShiftList(parseJson(event.body));
      await repo.saveShifts(shifts);
      return ok({ saved: shifts.length });
    });
}

export function getConfigWith(repo: Repo) {
  // The event is unused, but the signature stays uniform with the other routes.
  return (_event?: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => ok({ pay: await repo.readPaySettings() }));
}

export function putConfigWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      const pay = requirePaySettings(parseJson(event.body));
      await repo.savePaySettings(pay);
      return ok({ pay });
    });
}

// Production Lambda entry points.
export const getShifts = (e: APIGatewayProxyEventV2) => getShiftsWith(repoFromEnvironment())(e);
export const putShift = (e: APIGatewayProxyEventV2) => putShiftWith(repoFromEnvironment())(e);
export const putShifts = (e: APIGatewayProxyEventV2) => putShiftsWith(repoFromEnvironment())(e);
export const getConfig = (e: APIGatewayProxyEventV2) => getConfigWith(repoFromEnvironment())(e);
export const putConfig = (e: APIGatewayProxyEventV2) => putConfigWith(repoFromEnvironment())(e);
