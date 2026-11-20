import { notFound } from 'next/navigation';
import { Landing } from '@/components/landing/landing';

type Search = Record<string, string | string[] | undefined>;

/** The catalog the web suite's setup seeds (`plans:seed` from the fake Stripe). */
const SEEDED = ['Free', 'Starter', 'Pro', 'Enterprise'] as const;

/**
 * Test only: the landing page with pricing held in its loading or unavailable
 * state (`?pricing=loading|unavailable`), which the server's real read can't
 * be made to show on demand; or (`?pricing=seeded`) the real read narrowed to
 * the seeded catalog, so plans other tests create don't change a capture. A 404 unless the server runs with
 * `WEB_TEST_PAGES=1` (read per request; the web suite's setup sets it, no
 * deployment does).
 */
export default async function LandingStatesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (process.env.WEB_TEST_PAGES !== '1') notFound();
  const pricing = (await searchParams).pricing;

  return (
    <Landing
      pricing={
        pricing === 'loading' || pricing === 'unavailable' ? pricing : undefined
      }
      plans={pricing === 'seeded' ? SEEDED : undefined}
    />
  );
}
