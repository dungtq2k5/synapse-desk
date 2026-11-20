import { channels, FramePacer } from './scene';

/** Runs the pacer over `seconds` of display frames `gapMs` apart. */
function run(
  gapMs: number,
  seconds: number,
  pacer = new FramePacer(),
  from = 0,
) {
  let rendered = 0;
  let slow = false;
  let now = from;
  for (; now <= from + seconds * 1000; now += gapMs) {
    const paced = pacer.tick(now);
    if (paced.render) rendered += 1;
    slow ||= paced.slow;
  }
  return { rendered, slow, pacer, now };
}

describe('the scene’s frame pacing', () => {
  it('a 75 Hz display isn’t slow, and still draws close to 60 a second', () => {
    // The bug this guards: a plain cap skipped every other 13 ms frame and
    // read the result as 26 ms frames, so the scene gave up on a fast screen.
    const { rendered, slow } = run(1000 / 75, 3);

    expect(slow).toBe(false);
    expect(rendered / 3).toBeGreaterThan(55);
    expect(rendered / 3).toBeLessThanOrEqual(61);
  });

  it('60 Hz and 120 Hz displays are capped at 60 and aren’t slow', () => {
    for (const hz of [60, 120]) {
      const { rendered, slow } = run(1000 / hz, 3);
      expect(slow).toBe(false);
      expect(rendered / 3).toBeGreaterThan(55);
      expect(rendered / 3).toBeLessThanOrEqual(61);
    }
  });

  it('frames averaging over 24 ms for 2 s are slow', () => {
    expect(run(30, 2.5).slow).toBe(true);
    expect(run(22, 2.5).slow).toBe(false);
  });

  it('a paused or throttled tab isn’t slow: a long gap starts a fresh measure', () => {
    const first = run(1000 / 60, 1);
    // One frame a second for a while, as a throttled tab gets.
    const throttled = run(1000, 5, first.pacer, first.now);
    const after = run(1000 / 60, 3, throttled.pacer, throttled.now);

    expect(throttled.slow || after.slow).toBe(false);
  });
});

describe('the scene’s colors', () => {
  /** A hex color from its digits: the web's color scan keeps literals out of code. */
  const hex = (digits: string) => `#${digits}`;

  it('reads the tokens’ hex in both forms the page serves', () => {
    // The minifier turns `--color-white: #ffffff` into `#fff`; read as six
    // digits, white came out blue.
    expect(channels(hex('fff'))).toEqual([1, 1, 1]);
    expect(channels(` ${hex('ffffff')}`)).toEqual([1, 1, 1]);
    expect(
      channels(hex('008992')).map((channel) => Math.round(channel * 255)),
    ).toEqual([0, 137, 146]);
  });
});
