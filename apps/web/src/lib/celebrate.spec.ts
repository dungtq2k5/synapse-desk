// Kept on `globalThis`: a static import of the library would run this factory
// before anything this file declares exists, and the row must fail on its
// assertion, not on a crash.
type Counted = typeof globalThis & {
  confettiLoads?: number;
  confettiMock?: jest.Mock;
};
jest.mock('canvas-confetti', () => {
  const counted = globalThis as Counted;
  counted.confettiLoads = (counted.confettiLoads ?? 0) + 1;
  counted.confettiMock ??= jest.fn(() => Promise.resolve());
  return { __esModule: true, default: counted.confettiMock };
});

import { celebrate } from './celebrate';

const loads = () => (globalThis as Counted).confettiLoads ?? 0;
const drawn = () => (globalThis as Counted).confettiMock;

const motion = (reduce: boolean) => {
  globalThis.matchMedia = jest.fn((query: string) => ({
    matches: reduce && query.includes('reduce'),
  })) as unknown as typeof globalThis.matchMedia;
};

// jsdom has no canvas: the colors fall back to the library's own.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => null);
});
beforeEach(() => drawn()?.mockClear());

describe('celebrate', () => {
  it('loads the library only when it runs, not with the page', async () => {
    expect(loads()).toBe(0);
    motion(false);

    await celebrate();

    expect(loads()).toBe(1);
    expect(drawn()).toHaveBeenCalledTimes(1);
    expect(drawn()).toHaveBeenCalledWith(
      expect.objectContaining({ ticks: 90, disableForReducedMotion: true }),
    );
  });

  it('draws nothing under reduced motion', async () => {
    motion(true);

    await celebrate();

    expect(drawn()).not.toHaveBeenCalled();
  });
});
