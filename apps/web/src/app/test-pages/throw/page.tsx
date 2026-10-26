import { notFound } from 'next/navigation';
import { ThrowButton } from './throw-button';

/**
 * Test only: a button that throws an uncaught error, so the web suite can
 * follow one to the gateway's log. A 404 unless the server runs with
 * `WEB_TEST_PAGES=1` (read per request; the web suite's setup sets it, no
 * deployment does).
 */
export default function ThrowPage() {
  if (process.env.WEB_TEST_PAGES !== '1') notFound();

  return (
    <main id="main" className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Throw an error</h1>
      <ThrowButton />
    </main>
  );
}
