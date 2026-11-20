import { render } from '@testing-library/react';
import { TimeChart } from './charts';

const period = (day: number, noData: boolean) => ({
  key: `2026-10-0${day}`,
  from: `2026-10-0${day}`,
  to: `2026-10-0${day}`,
  days: 1,
  partial: false,
  noData,
});

/** The "No data" band: four days, the middle two not computed. */
function band(kind: 'line' | 'column') {
  const { container } = render(
    <TimeChart
      title="Volume"
      kind={kind}
      periods={[
        period(1, false),
        period(2, true),
        period(3, true),
        period(4, false),
      ]}
      labels={['1', '2', '3', '4']}
      titles={['1 Oct', '2 Oct', '3 Oct', '4 Oct']}
      series={[{ name: 'Tickets', color: 1, values: [1, null, null, 2] }]}
      axis={String}
      value={String}
      endLabels={false}
    />,
  );
  const rect = container.querySelector('rect.fill-muted')!;
  return {
    x: Number(rect.getAttribute('x')),
    width: Number(rect.getAttribute('width')),
  };
}

// The plot measures 156 px: 44 for the axis, 12 at the right, 100 drawn.
beforeAll(() => {
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(156);
});

describe('the no-data band', () => {
  it('covers a line’s gap days to halfway to their neighbors', () => {
    // Points 100/3 apart: from point 1 less half a gap to point 2 plus half.
    const { x, width } = band('line');
    expect(x).toBeCloseTo(44 + 100 / 3 - 50 / 3);
    expect(width).toBeCloseTo(200 / 3);
  });

  it('covers a column chart’s gap columns whole', () => {
    // Columns 25 wide: the band is the second and third.
    const { x, width } = band('column');
    expect(x).toBeCloseTo(44 + 25);
    expect(width).toBeCloseTo(50);
  });
});
