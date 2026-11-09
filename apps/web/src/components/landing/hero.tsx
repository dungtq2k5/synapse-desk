import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { SceneLoader } from './scene-loader';
import { SceneStill } from './scene-still';

const HERO_ID = 'hero';

/**
 * The hero, full bleed on `scene-backdrop`. 1440: the words on the left
 * (540 px), the scene on the right (800 × 640). 390: the scene above
 * (390 × 280), the words under it. Nothing overlaps, so no scrim.
 *
 * The headline is in the first HTML and the scene's still is an inline SVG,
 * so the largest paint is the words. The buttons stay on the left at both
 * widths: they follow the words they belong to.
 */
export function Hero() {
  return (
    <section
      id={HERO_ID}
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-scene-backdrop"
    >
      <div className="mx-auto flex max-w-360 flex-col lg:h-160 lg:flex-row-reverse">
        <div className="h-70 w-full lg:h-160 lg:w-200 lg:shrink-0">
          <SceneLoader hero={HERO_ID}>
            <SceneStill />
          </SceneLoader>
        </div>
        <div className="flex flex-col justify-center px-4 pt-2 pb-16 lg:w-160 lg:shrink-0 lg:py-0 lg:pr-0 lg:pl-30">
          <h1 id="hero-title" className="type-display lg:type-hero">
            Support that answers from your own documents
          </h1>
          <p className="mt-6 text-base text-muted-foreground">
            SynapseDesk’s AI answers your customers first, from your
            organization’s documents, and shows where each answer came from.
            When it can’t answer, a person on your team takes over.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Start free
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              Sign in
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Free plan. No card needed.
          </p>
        </div>
      </div>
    </section>
  );
}
