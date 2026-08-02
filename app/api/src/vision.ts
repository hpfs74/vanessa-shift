/** The photo reading: the only point that talks to the model.
 *
 * It doesn't judge anything. It returns what it received, already
 * deserialized, and leaves it to `core` to say whether it's usable: the
 * judgment is domain logic, and must be testable without a network.
 *
 * The prompt is in Italian like the sheet it describes: the codes, the month
 * names and the word "turno" (shift) are the document's own vocabulary.
 */

import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';

import { ROW_NAME, READING_SCHEMA, SHIFTS } from '@vanessa/core';

/** The cross-region inference profile, not the bare model id.
 *
 * `anthropic.claude-opus-5` is what `list-foundation-models` shows in
 * eu-south-1, and calling it returns "The model does not exist": in the EU
 * regions the callable identifier is the `eu.` profile, which routes the
 * request across the European regions that host the model. The bare id is the
 * model; this is the thing you are allowed to invoke. */
export const MODEL = 'eu.anthropic.claude-opus-5';
export const REGION = process.env.AWS_REGION ?? 'eu-south-1';

/** The minimum the client needs, so the tests don't pull in the SDK. */
export interface MessagesResponse {
  stop_reason?: string | null;
  content: { type: string; text?: string }[];
}
export interface MessagesClient {
  messages: { create(body: unknown): Promise<MessagesResponse> };
}

export type Vision = (imageBase64: string) => Promise<unknown>;

export type VisionFailureReason = 'refusal' | 'truncated' | 'no-text' | 'not-json';

/** The reading didn't succeed. The caller translates it into a message. */
export class VisionFailed extends Error {
  constructor(
    message: string,
    public readonly reason: VisionFailureReason,
  ) {
    super(message);
  }
}

const CODES = SHIFTS.map((s) => s.code).join(', ');

const PROMPT = `Questa foto e' il foglio dei turni mensile di una struttura sanitaria.

E' una griglia: ogni riga e' una persona, ogni colonna e' un giorno del mese.
Sopra le colonne c'e' una riga con i numeri dei giorni, da 1 fino alla fine del
mese: usala per allineare le colonne, non contarle a occhio. In alto c'e' il
titolo con il mese e l'anno.

Devi leggere UNA SOLA riga: quella della persona di nome ${ROW_NAME}.
I nomi stanno a sinistra, su due righe (cognome sopra, nome sotto): la riga dei
turni e' quella del nome.

Per ogni giorno del mese riporta la sigla che sta nella cella di quella riga.
Le sigle valide sono soltanto: ${CODES}.
Se la cella contiene una x, e' vuota, oppure non riesci a leggerla con
ragionevole certezza, metti code null.

Attenzione: le altre righe contengono anche sigle diverse (F, R, C, N1 e altre).
Non riguardano questa persona. Non riportare mai la cella di un'altra riga.

Riporta un elemento per OGNI giorno del mese, dal primo all'ultimo, anche per i
giorni con code null. Metti confident a false quando la cella e' sbiadita,
corretta a mano, ambigua o coperta.

In foundName scrivi il nome cosi' come sta scritto sul foglio, e in foundRow il
numero della riga se il foglio lo mostra, altrimenti null.

Se nella foto non c'e' nessuna riga intestata a ${ROW_NAME}, metti found a
false e days a un elenco vuoto.`;

/** Reasoning on Claude Opus 5 is on by default, and that's what's needed:
 *  counting thirty-one crooked, handwritten columns isn't a glance. The token
 *  cap covers reasoning plus response together, so it's set generous: too
 *  tight, and it truncates halfway. */
const MAX_TOKENS = 8000;

export function createVision(client?: MessagesClient): Vision {
  const c: MessagesClient =
    client ?? (new AnthropicBedrockMantle({ awsRegion: REGION }) as unknown as MessagesClient);

  return async (imageBase64: string) => {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: 'json_schema', schema: READING_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    // Classifiers can refuse: that's a 200 with empty content, not an HTTP
    // error. Reading content[0] here would give an undefined that travels on.
    if (response.stop_reason === 'refusal') {
      throw new VisionFailed('the model refused the request', 'refusal');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new VisionFailed('response was truncated', 'truncated');
    }

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) throw new VisionFailed('no text block in the response', 'no-text');

    try {
      return JSON.parse(text);
    } catch {
      throw new VisionFailed('the response is not JSON', 'not-json');
    }
  };
}
