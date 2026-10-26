import { notFound } from 'next/navigation';

/**
 * Test only: a page whose render fails, so the web suite can reach this
 * segment's error screen. A 404 unless the server runs with
 * `WEB_TEST_PAGES=1` (read per request; the web suite's setup sets it, no
 * deployment does).
 */
export default function RenderErrorPage(): never {
  if (process.env.WEB_TEST_PAGES !== '1') notFound();
  throw new Error('A test page failed to render');
}
