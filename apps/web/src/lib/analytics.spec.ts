import { AI_GENERATION_PURPOSES } from '@synapsedesk/contracts';
import {
  PURPOSE_WORDS,
  change,
  daysText,
  duration,
  periodLabel,
  periods,
  presets,
  previousWindow,
  rangeText,
  rateText,
  readFilters,
  spanDays,
  writeFilters,
} from './analytics';

const TODAY = '2026-10-19';

describe('the filters in the address', () => {
  it('a missing range is the last 30 days, or the limit when shorter', () => {
    expect(readFilters(new URLSearchParams(), 180, TODAY).filters).toEqual({
      from: '2026-09-20',
      to: TODAY,
      department: null,
      by: 'DAY',
    });
    expect(readFilters(new URLSearchParams(), 7, TODAY).filters.from).toBe(
      '2026-10-13',
    );
  });

  it('a range longer than the plan keeps its end and says it was clamped', () => {
    const params = new URLSearchParams({
      from: '2026-06-01',
      to: '2026-10-19',
    });
    expect(readFilters(params, 30, TODAY)).toEqual({
      filters: expect.objectContaining({
        from: '2026-09-20',
        to: '2026-10-19',
      }),
      clamped: true,
    });
  });

  it('a broken or inverted range is the default, unclamped', () => {
    for (const range of [
      { from: 'yesterday', to: TODAY },
      { from: '2026-10-19', to: '2026-10-01' },
      { from: '2026-02-30', to: '2026-03-01' },
    ]) {
      const { filters, clamped } = readFilters(
        new URLSearchParams(range),
        180,
        TODAY,
      );
      expect([filters.from, clamped]).toEqual(['2026-09-20', false]);
    }
  });

  it('round-trips, leaving defaults out', () => {
    const filters = {
      from: '2026-09-20',
      to: TODAY,
      department: 'd-1',
      by: 'WEEK' as const,
    };
    const query = writeFilters(filters);
    expect(query).toBe('from=2026-09-20&to=2026-10-19&department=d-1&by=week');
    expect(readFilters(new URLSearchParams(query), 180, TODAY).filters).toEqual(
      filters,
    );
    expect(writeFilters({ ...filters, department: null, by: 'DAY' })).toBe(
      'from=2026-09-20&to=2026-10-19',
    );
  });
});

describe('days', () => {
  it('counts both ends, and the previous window is as long', () => {
    expect(spanDays('2026-09-20', TODAY)).toBe(30);
    expect(previousWindow('2026-09-20', TODAY)).toEqual({
      from: '2026-08-21',
      to: '2026-09-19',
    });
  });

  it('presets past the plan are locked', () => {
    expect(
      presets(TODAY, 30).map((preset) => [
        preset.label,
        preset.days,
        preset.locked,
      ]),
    ).toEqual([
      ['Last 7 days', 7, false],
      ['Last 30 days', 30, false],
      ['Last 90 days', 90, true],
      ['Last 180 days', 180, true],
      ['This month', 19, false],
      ['Last month', 30, false],
    ]);
  });

  it('writes ranges and lists of days as the deck does', () => {
    expect(rangeText('2026-09-20', TODAY)).toBe(
      '20 Sept – 19 Oct 2026 · 30 days',
    );
    expect(rangeText('2025-12-20', '2026-01-18')).toBe(
      '20 Dec 2025 – 18 Jan 2026 · 30 days',
    );
    expect(daysText(['2026-10-08', '2026-10-09'])).toBe('8–9 Oct');
    expect(daysText(['2026-10-08', '2026-10-10'])).toBe('8 Oct and 10 Oct');
  });
});

describe('periods', () => {
  it('weeks start on Monday; the range cuts the first and last short', () => {
    const weeks = periods('2026-09-20', TODAY, 'WEEK', TODAY);
    expect(weeks.map((week) => [week.key, week.days, week.partial])).toEqual([
      ['2026-09-14', 1, true],
      ['2026-09-21', 7, false],
      ['2026-09-28', 7, false],
      ['2026-10-05', 7, false],
      ['2026-10-12', 7, false],
      ['2026-10-19', 1, true],
    ]);
    expect(periodLabel(weeks[0], 'WEEK')).toBe('20 Sept (1 day)');
    expect(periodLabel(weeks[1], 'WEEK')).toBe('21 Sept');
  });

  it('days after dataThrough are no data; with no run, every day is', () => {
    const days = periods('2026-10-15', TODAY, 'DAY', '2026-10-17');
    expect(days.map((day) => day.noData)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(
      periods('2026-10-15', TODAY, 'DAY', null).every((day) => day.noData),
    ).toBe(true);
  });

  it('months are keyed on the 1st and labelled with the year', () => {
    const months = periods('2026-08-15', TODAY, 'MONTH', TODAY);
    expect(months.map((month) => [month.key, month.partial])).toEqual([
      ['2026-08-01', true],
      ['2026-09-01', false],
      ['2026-10-01', true],
    ]);
    expect(periodLabel(months[1], 'MONTH')).toBe('Sept 2026');
  });
});

describe('numbers in words', () => {
  it('durations use two units at most', () => {
    expect([8, 59, 720, 8460, 7200, 97_200, 86_400].map(duration)).toEqual([
      '8 s',
      '59 s',
      '12 min',
      '2 h 21 min',
      '2 h',
      '1 d 3 h',
      '1 d',
    ]);
  });

  it('a rate carries its counts; no rate is a dash', () => {
    expect(rateText({ rate: 0.846, numerator: 170, denominator: 200 })).toBe(
      '85% (170 of 200)',
    );
    expect(rateText({ numerator: 0, denominator: 0 })).toBe('—');
  });

  it('the change against the previous window, in neutral words', () => {
    expect(change('count', 415, 392, 30)).toBe('+6% vs the previous 30 days');
    expect(change('count', 380, 392, 30)).toBe('−3% vs the previous 30 days');
    expect(change('count', 5, 0, 30)).toBeNull();
    expect(change('rate', 0.62, 0.59, 30)).toBe(
      '+3 points vs the previous 30 days',
    );
    expect(change('rate', 0.85, 0.86, 30)).toBe(
      '−1 point vs the previous 30 days',
    );
    expect(change('time', 8460, 9180, 30)).toBe(
      '−12 min vs the previous 30 days',
    );
    expect(change('time', 8, 8.2, 30)).toBe(
      'No change vs the previous 30 days',
    );
    expect(change('rate', null, 0.5, 30)).toBeNull();
  });
});

describe('AI purposes in words', () => {
  it('names every purpose the ledger records, so none shows as its raw value', () => {
    for (const purpose of AI_GENERATION_PURPOSES) {
      expect(PURPOSE_WORDS[purpose]).toEqual(expect.any(String));
    }
    expect(PURPOSE_WORDS.CONFLICT_CHECK).toBe(
      'Conflict checks between documents',
    );
  });
});
