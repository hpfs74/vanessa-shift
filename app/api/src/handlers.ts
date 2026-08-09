/** The four Lambda handlers. The repo is injected so they test without a network. */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import {
  InvalidReading,
  MAX_READINGS_PER_DAY,
  RowNotFound,
  romeToday,
  validateReading,
} from '@vanessa/core';
import type { IsoDate, PaySettings, Profile } from '@vanessa/core';

import type { Repo } from './repo.js';
import { createRepo } from './repo.js';
import { requireSignedIn } from './token.js';
import {
  failure,
  handle,
  ok,
  optionalText,
  parseJson,
  requireDate,
  requireFromCloudFront,
  requireHoursOverride,
  requireImage,
  requireObject,
  requirePaySettings,
  requireProfile,
  requireRange,
  requireShiftCode,
  requireShiftList,
  requireSwapKind,
} from './http.js';
import type { Vision } from './vision.js';
import { VisionFailed, createVision } from './vision.js';

function repoFromEnvironment(): Repo {
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error('environment variable TABLE_NAME is not set');
  return createRepo(table);
}

export function getShiftsWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      requireFromCloudFront(event.headers);
      const q = event.queryStringParameters ?? {};
      const { from, to } = requireRange(q.from, q.to);
      return ok({ shifts: await repo.shiftsBetween(from, to) });
    });
}

export function putShiftWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      requireFromCloudFront(event.headers);
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
      requireFromCloudFront(event.headers);
      const shifts = requireShiftList(parseJson(event.body));
      await repo.saveShifts(shifts);
      return ok({ saved: shifts.length });
    });
}

export function getConfigWith(repo: Repo) {
  return (event?: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      requireFromCloudFront(event?.headers);
      // Three independent reads: one round trip, not three.
      // The quota row is keyed by Rome's day, because that is the day
      // `readPhotoWith` consumes it under — the reader has to use the same
      // clock as the writer, or the two disagree for an hour or two after
      // midnight while the Lambda's own clock (UTC) is still on yesterday.
      const [pay, profile, used] = await Promise.all([
        repo.readPaySettings(),
        repo.readProfile(),
        repo.readPhotoQuota(romeToday()),
      ]);
      // The daily maximum is not here on purpose: `MAX_READINGS_PER_DAY`
      // lives in `core`, which the frontend imports.
      return ok({ pay, profile, quota: { used } });
    });
}

/** Writes only what it was given, and the two halves land on separate rows.
 *
 *  A body carrying neither key is the bare `PaySettings` this route took
 *  before the profile existed. It keeps working because the app is a cached
 *  bundle on a phone: after a deploy it may well send the old shape for a
 *  while, and that is a failure nobody would see in development. */
export function putConfigWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      requireFromCloudFront(event.headers);
      const body = parseJson(event.body);
      const hasPay = 'pay' in body;
      const hasProfile = 'profile' in body;

      if (!hasPay && !hasProfile) {
        const pay = requirePaySettings(body);
        await repo.savePaySettings(pay);
        return ok({ pay });
      }

      // Both halves are validated before either is written: a 400 has to mean
      // nothing was accepted, and a partial write (valid pay, invalid
      // profile) would leave the pay row changed under a response that says
      // otherwise.
      const pay = hasPay ? requirePaySettings(requireObject(body.pay, 'pay')) : undefined;
      const profile = hasProfile ? requireProfile(requireObject(body.profile, 'profile')) : undefined;

      const written: { pay?: PaySettings; profile?: Profile } = {};
      if (pay) {
        await repo.savePaySettings(pay);
        written.pay = pay;
      }
      if (profile) {
        await repo.saveProfile(profile);
        written.profile = profile;
      }
      return ok(written);
    });
}

/** Two causes, one way out: the photo could not be read, or what came back
 *  did not respect the schema. Neither is fixed by waiting a minute. */
const UNREADABLE =
  'Non sono riuscito a leggere questo foglio. Prova con piu luce, o scrivi i codici a mano.';

/** Reads a photo of the sheet and returns what's written on it.
 *
 * The order of the checks is the defense. The caller must be signed in
 * before anything else runs — an unauthenticated request must never reach
 * the quota, or anyone who merely knows the address could empty Vanessa's
 * ten readings a day without having any access at all. Then the huge is
 * rejected before spending anything, then the quota is consumed before
 * calling the model, and the quota is NOT refunded if the model fails —
 * otherwise anyone abusing it gets free attempts by making the reading fail
 * on purpose.
 *
 * It writes no shift: saving stays on PUT /shifts, which already has the
 * review of what would be overwritten.
 */
export function readPhotoWith(
  repo: Repo,
  vision: Vision,
  today: () => IsoDate = romeToday,
  year: () => number = () => new Date().getFullYear(),
  signedIn: (h: Record<string, string | undefined> | undefined) => Promise<void> = requireSignedIn,
) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      await signedIn(event.headers);

      const image = requireImage(parseJson(event.body).image);

      if (!(await repo.consumePhotoQuota(today(), MAX_READINGS_PER_DAY))) {
        return failure(
          429,
          `Hai gia' usato le ${MAX_READINGS_PER_DAY} letture di oggi. Riprova domani, oppure scrivi i codici a mano.`,
        );
      }

      let raw: unknown;
      try {
        raw = await vision(image);
      } catch (e) {
        // A VisionFailed means the model answered, and the answer is unusable:
        // a refusal, a truncation, no text, or text that is not JSON. Retrying
        // reproduces it exactly, at the cost of another reading — so the way
        // out is the one that doesn't need the service.
        if (e instanceof VisionFailed) {
          console.error('photo reading failed', e.reason, e.message);
          return failure(422, UNREADABLE);
        }
        // Anything else came from Bedrock itself: an outage, a throttle, a
        // timeout. That is the failure "try again in a minute" was written for.
        console.error('the model call failed', e);
        return failure(502, 'Il servizio non risponde. Riprova fra un minuto.');
      }

      try {
        return ok({ reading: validateReading(raw, year()) });
      } catch (e) {
        if (e instanceof RowNotFound) {
          return failure(
            422,
            'Non ho trovato la riga di Vanessa in questa foto. Controlla che si veda tutta la riga, dal nome fino all ultimo giorno.',
          );
        }
        if (e instanceof InvalidReading) {
          console.error('invalid reading', e.message);
          return failure(422, UNREADABLE);
        }
        throw e;
      }
    });
}

// Production Lambda entry points.
export const getShifts = (e: APIGatewayProxyEventV2) => getShiftsWith(repoFromEnvironment())(e);
export const putShift = (e: APIGatewayProxyEventV2) => putShiftWith(repoFromEnvironment())(e);
export const putShifts = (e: APIGatewayProxyEventV2) => putShiftsWith(repoFromEnvironment())(e);
export const getConfig = (e: APIGatewayProxyEventV2) => getConfigWith(repoFromEnvironment())(e);
export const putConfig = (e: APIGatewayProxyEventV2) => putConfigWith(repoFromEnvironment())(e);
export const readPhoto = (e: APIGatewayProxyEventV2) =>
  readPhotoWith(repoFromEnvironment(), createVision())(e);
