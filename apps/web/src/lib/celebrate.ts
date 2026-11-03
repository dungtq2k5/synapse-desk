/** The tokens a celebration is drawn in: the brand, then the chart palette. */
const COLOR_TOKENS = [
  '--primary',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
];

/**
 * A token's current color as hex, the only form `canvas-confetti` reads. The
 * tokens may be any CSS color (`oklch(…)` included), so the browser paints one
 * pixel and reports it back.
 */
function hexOf(token: string): string | null {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  const context = document.createElement('canvas').getContext('2d');
  if (!value || !context) return null;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A burst of confetti for an organization's new or bigger plan: about a second
 * and a half, in the brand and chart colors, silent, on a canvas that takes no
 * clicks. Nothing under reduced motion. `canvas-confetti` loads here, on the
 * first celebration, so no page's first load carries it.
 *
 * @example
 * void celebrate(); // once the upgrade is confirmed
 */
export async function celebrate(): Promise<void> {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const { default: confetti } = await import('canvas-confetti');
  const colors = COLOR_TOKENS.map(hexOf).filter(
    (color): color is string => color !== null,
  );
  await confetti({
    particleCount: 120,
    spread: 75,
    startVelocity: 40,
    // About 1.5 s at 60 frames a second.
    ticks: 90,
    origin: { y: 0.6 },
    colors: colors.length > 0 ? colors : undefined,
    disableForReducedMotion: true,
  });
}
