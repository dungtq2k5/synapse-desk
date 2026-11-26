import { readListed, repoFiles } from '@synapsedesk/testing/repo-files';

/**
 * No gateway handler answers every method: no `@All()`, and no
 * `@RequestMapping()` (which defaults to every method).
 *
 * The HTTP metrics recorder reads a route that answers several methods as a
 * middleware's mount (Nest mounts path-bound middleware with Express `all()`),
 * and labels its refusals `refused-before-routing`. A handler declared for
 * every method would have its whole traffic filed under that label.
 */
describe('a gateway controller', () => {
  const EVERY_METHOD = /@(?:All|RequestMapping)\(/g;

  /** The source without its comments, so a comment naming a decorator isn't one. */
  const code = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  it('declares each handler for one method', () => {
    const controllers = readListed(
      repoFiles('services/api-gateway/src').filter((file) =>
        file.endsWith('.controller.ts'),
      ),
    );

    // The scan saw the controllers, so an empty result means none, not a miss.
    expect(controllers.length).toBeGreaterThan(20);
    expect(
      controllers.flatMap(({ path, text }) =>
        [...code(text).matchAll(EVERY_METHOD)].map(
          (match) => `${path}: ${match[0]}`,
        ),
      ),
    ).toEqual([]);
  });
});
