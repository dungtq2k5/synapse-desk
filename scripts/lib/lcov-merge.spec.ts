import { merge, parse } from './lcov-merge.cjs';

const lcov = (body: string) => `${body.trim()}\nend_of_record\n`;

describe('lcov-merge', () => {
  it('reads paths relative to the root, hits and branches by key', () => {
    const files = parse(
      lcov('SF:/repo/a.ts\nDA:1,2\nDA:2,0\nBRDA:3,0,0,1\nBRDA:3,0,1,-'),
      '/repo',
    );
    const file = files.get('a.ts');
    expect(file?.lines).toEqual(
      new Map([
        [1, 2],
        [2, 0],
      ]),
    );
    expect(file?.branches.get(3)).toEqual(
      new Map([
        ['0,0', 1],
        ['0,1', 0],
      ]),
    );
  });

  it('unions Jest reports by key: arms each covered by one report are both covered', () => {
    const out = merge({
      same: [
        lcov('SF:a.ts\nDA:1,1\nBRDA:1,4,0,1\nBRDA:1,4,1,0'),
        lcov('SF:a.ts\nDA:1,0\nBRDA:1,4,0,0\nBRDA:1,4,1,3'),
      ],
      other: [],
      root: '/repo',
    });
    expect(out).toContain('DA:1,1');
    expect(out.match(/BRDA:1,0,\d+,1/g)).toHaveLength(2);
  });

  it('folds the web report in by line, never adding its numbering to Jest’s', () => {
    const out = merge({
      // Jest: two conditions on line 5, one taken; line 9 never ran.
      same: [lcov('SF:a.ts\nDA:5,1\nDA:9,0\nBRDA:5,2,0,1\nBRDA:5,2,1,0')],
      // The web suite: the same two conditions, numbered its own way, both
      // taken; and line 9 ran.
      other: [lcov('SF:a.ts\nDA:5,4\nDA:9,2\nBRDA:5,7,0,3\nBRDA:5,7,1,1')],
      root: '/repo',
    });
    expect(out).toContain('DA:5,5');
    expect(out).toContain('DA:9,2');
    // Two conditions, not four; both covered.
    expect(out.match(/BRDA:5,/g)).toHaveLength(2);
    expect(out.match(/BRDA:5,0,\d+,1/g)).toHaveLength(2);
  });

  it('keeps a file only one kind reports', () => {
    const out = merge({
      same: [lcov('SF:a.ts\nDA:1,1')],
      other: [lcov('SF:web.tsx\nDA:2,0\nBRDA:2,0,0,0\nBRDA:2,0,1,1')],
      root: '/repo',
    });
    expect(out).toContain('SF:a.ts\nDA:1,1\nend_of_record');
    expect(out).toContain('SF:web.tsx\nDA:2,0\nBRDA:2,0,0,1\nBRDA:2,0,1,0');
  });
});
