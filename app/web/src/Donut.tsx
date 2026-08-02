/** A part-to-whole donut, drawn as plain SVG.
 *
 * Donut and not pie: the hole holds the total, which is the number the reader
 * usually wants first, and it turns a chart that only shows proportions into
 * one that also shows magnitude.
 *
 * No chart library. The only thing a library would add here is arc maths and
 * a few hundred kilobytes; the maths is twenty lines.
 *
 * Identity never rests on colour alone: every slice has a legend row carrying
 * the shift code, and the values are always visible rather than hidden behind
 * a hover that a phone cannot produce.
 */

export interface Slice {
  readonly key: string;
  /** The short label, e.g. the shift code. Carries identity without colour. */
  readonly label: string;
  readonly description: string;
  readonly value: number;
  readonly colour: string;
}

export interface DonutProps {
  title: string;
  slices: readonly Slice[];
  /** Word for the unit, shown under the total: "ore", "giorni". */
  unit: string;
  /** Shown in place of the chart when there is nothing to draw. */
  emptyText: string;
}

const SIZE = 200;
const CENTRE = SIZE / 2;
const OUTER = 92;
const INNER = 58;

function polar(radius: number, fraction: number): [number, number] {
  // Starts at twelve o'clock and runs clockwise, the direction a reader expects.
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return [CENTRE + radius * Math.cos(angle), CENTRE + radius * Math.sin(angle)];
}

function arcPath(from: number, to: number): string {
  const [ox1, oy1] = polar(OUTER, from);
  const [ox2, oy2] = polar(OUTER, to);
  const [ix2, iy2] = polar(INNER, to);
  const [ix1, iy1] = polar(INNER, from);
  const wide = to - from > 0.5 ? 1 : 0;
  return [
    `M ${ox1} ${oy1}`,
    `A ${OUTER} ${OUTER} 0 ${wide} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${INNER} ${INNER} 0 ${wide} 0 ${ix1} ${iy1}`,
    'Z',
  ].join(' ');
}

const percent = (v: number, total: number): string =>
  total === 0 ? '' : `${Math.round((v / total) * 100)}%`;

export function Donut({ title, slices, unit, emptyText }: DonutProps) {
  const present = slices.filter((s) => s.value > 0);
  const total = present.reduce((a, s) => a + s.value, 0);

  if (total === 0) {
    return (
      <figure className="donut">
        <figcaption>{title}</figcaption>
        <p className="note">{emptyText}</p>
      </figure>
    );
  }

  // A single category is a full circle: an arc from 0 to 1 collapses to a
  // point in SVG, so it has to be drawn as two rings instead.
  const onlyOne = present.length === 1;

  let cursor = 0;
  const wedges = present.map((s) => {
    const from = cursor;
    cursor += s.value / total;
    return { slice: s, from, to: cursor };
  });

  return (
    <figure className="donut">
      <figcaption>{title}</figcaption>

      <div className="donut-body">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="donut-svg"
          role="img"
          aria-label={`${title}: ${present
            .map((s) => `${s.label} ${s.value} ${unit}, ${percent(s.value, total)}`)
            .join('; ')}`}
        >
          {onlyOne ? (
            <>
              <circle cx={CENTRE} cy={CENTRE} r={(OUTER + INNER) / 2}
                fill="none" stroke={present[0]!.colour} strokeWidth={OUTER - INNER} />
              <title>{`${present[0]!.label} · 100%`}</title>
            </>
          ) : (
            wedges.map(({ slice, from, to }) => (
              <path
                key={slice.key}
                d={arcPath(from, to)}
                fill={slice.colour}
                // A hairline of the surface colour between fills, so two
                // touching slices never read as one.
                stroke="var(--surface)"
                strokeWidth={2}
              >
                <title>{`${slice.label} · ${slice.value} ${unit} · ${percent(slice.value, total)}`}</title>
              </path>
            ))
          )}

          <text x={CENTRE} y={CENTRE - 4} className="donut-total">
            {total}
          </text>
          <text x={CENTRE} y={CENTRE + 16} className="donut-unit">
            {unit}
          </text>
        </svg>

        <ul className="donut-legend">
          {present.map((s) => (
            <li key={s.key}>
              <span className="chip" style={{ background: s.colour }} aria-hidden="true" />
              <span className="chip-code">{s.label}</span>
              <span className="chip-desc">{s.description}</span>
              <span className="chip-value">
                {s.value} <small>{percent(s.value, total)}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
