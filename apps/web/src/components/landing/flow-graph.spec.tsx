import { render } from '@testing-library/react';
import { FlowGraph } from './flow-graph';

/** Motion allowed (or not), and nothing to observe: jsdom has neither. */
function setUp(reduced: boolean) {
  window.matchMedia = ((media: string) => ({
    matches: media.includes('reduce') ? reduced : false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
}

describe('the flow graph’s light', () => {
  it('every animation’s keyTimes start at 0, end at 1 and never fall', () => {
    // SMIL rejects anything else, and the browser says so in the console:
    // the rail's last pulse once ran past the end of its loop.
    setUp(false);
    const { container } = render(<FlowGraph />);
    const lists = [...container.querySelectorAll('[keyTimes], [keytimes]')].map(
      (animation) =>
        (
          animation.getAttribute('keyTimes') ??
          animation.getAttribute('keytimes') ??
          ''
        )
          .split(';')
          .map(Number),
    );

    expect(lists.length).toBeGreaterThanOrEqual(8);
    for (const times of lists) {
      expect(times[0]).toBe(0);
      expect(times.at(-1)).toBe(1);
      for (let index = 1; index < times.length; index += 1) {
        expect(times[index]).toBeGreaterThanOrEqual(times[index - 1]);
      }
    }
  });

  it('isn’t there at all under reduced motion', () => {
    setUp(true);
    const { container } = render(<FlowGraph />);

    expect(container.querySelectorAll('animate, animateMotion')).toHaveLength(
      0,
    );
    // The steps are, every one, in order.
    expect(container.querySelectorAll('ol > li')).toHaveLength(4);
  });
});
