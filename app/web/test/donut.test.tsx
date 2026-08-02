import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Donut, type Slice } from '../src/Donut.js';

const slice = (label: string, value: number, colour = '#2a78d6'): Slice => ({
  key: label,
  label,
  description: `descrizione ${label}`,
  value,
  colour,
});

const render1 = (slices: Slice[]) =>
  render(
    <Donut title="Ore per turno" unit="ore" emptyText="Niente da mostrare." slices={slices} />,
  );

describe('donut', () => {
  it('says so plainly when there is nothing to draw', () => {
    render1([slice('M', 0), slice('P', 0)]);
    expect(screen.getByText('Niente da mostrare.')).toBeInTheDocument();
    // No empty ring pretending to be a chart.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('treats an empty list the same as all-zero', () => {
    render1([]);
    expect(screen.getByText('Niente da mostrare.')).toBeInTheDocument();
  });

  it('shows the total in the hole', () => {
    render1([slice('M', 30), slice('P', 10)]);
    const chart = screen.getByRole('img');
    expect(within(chart).getByText('40')).toBeInTheDocument();
    expect(within(chart).getByText('ore')).toBeInTheDocument();
  });

  it('gives every slice a legend row with code, value and share', () => {
    render1([slice('M', 30), slice('P', 10)]);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('M')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('75%')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('25%')).toBeInTheDocument();
  });

  it('leaves out categories worth nothing instead of drawing a zero slice', () => {
    render1([slice('M', 30), slice('M1', 0), slice('P', 10)]);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('M1')).not.toBeInTheDocument();
  });

  it('draws a single category as a full ring, not a collapsed arc', () => {
    // An SVG arc from 0 to 1 turn starts and ends at the same point and
    // renders as nothing: the whole chart would silently disappear.
    const { container } = render1([slice('M', 12)]);
    expect(container.querySelector('circle')).toBeInTheDocument();
    expect(container.querySelector('path')).not.toBeInTheDocument();
    expect(within(screen.getByRole('img')).getByText('12')).toBeInTheDocument();
  });

  it('draws one wedge per non-zero category', () => {
    const { container } = render1([slice('M', 5), slice('P', 5), slice('L', 5)]);
    expect(container.querySelectorAll('path')).toHaveLength(3);
  });

  it('separates touching slices with a gap in the surface colour', () => {
    const { container } = render1([slice('M', 5), slice('P', 5)]);
    for (const path of container.querySelectorAll('path')) {
      expect(path.getAttribute('stroke')).toBe('var(--surface)');
      expect(path.getAttribute('stroke-width')).toBe('2');
    }
  });

  it('describes itself for a reader who cannot see it', () => {
    render1([slice('M', 30), slice('P', 10)]);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Ore per turno: M 30 ore, 75%; P 10 ore, 25%',
    );
  });

  it('keeps the wedges in the order given, starting from twelve o clock', () => {
    const { container } = render1([slice('M', 25), slice('P', 25), slice('L', 50)]);
    const paths = [...container.querySelectorAll('path')];
    // First wedge starts at the top: x equals the centre, y at the outer edge.
    expect(paths[0]!.getAttribute('d')).toMatch(/^M 100 8/);
  });

  it('rounds the shares without inventing a total', () => {
    render1([slice('M', 1), slice('P', 1), slice('L', 1)]);
    const rows = screen.getAllByRole('listitem');
    for (const row of rows) expect(within(row).getByText('33%')).toBeInTheDocument();
    expect(within(screen.getByRole('img')).getByText('3')).toBeInTheDocument();
  });
});
