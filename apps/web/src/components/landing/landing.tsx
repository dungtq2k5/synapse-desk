import { Features } from './features';
import { Hero } from './hero';
import { HowItWorks } from './how-it-works';
import { LandingFooter } from './landing-footer';
import { LandingHeader } from './landing-header';
import { Pricing } from './pricing';

/**
 * The landing page, for a visitor at `/`: the sticky header, the
 * hero, how it works, what's inside, pricing and the footer. A `min-h-svh`
 * column, so the footer sits at the bottom of a short page too.
 */
export function Landing({
  pricing,
  plans,
}: {
  /** Test pages only: pricing held in one of its states. */
  pricing?: 'loading' | 'unavailable';
  /** Test pages only: the plans pricing shows, by name. */
  plans?: readonly string[];
} = {}) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <LandingHeader />
      <main id="main" tabIndex={-1} className="flex flex-col outline-none">
        <Hero />
        <HowItWorks />
        <Features />
        <Pricing state={pricing} only={plans} />
      </main>
      <LandingFooter supportEmail={process.env.SUPPORT_EMAIL ?? ''} />
    </div>
  );
}
