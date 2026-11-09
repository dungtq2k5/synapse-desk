import Image from 'next/image';
import Link from 'next/link';
import { Lockup } from '@/components/brand/lockup';
import { buttonVariants } from '@/components/ui/button';
import { LandingMenu } from './landing-menu';
import { SECTIONS } from './sections';

/**
 * The landing page's sticky header. 1440: the lockup, the two section links,
 * Sign in and Start free. 390: the mark alone, Sign in and Start free at `sm`,
 * and the menu holding the section links.
 */
export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="relative mx-auto flex h-14 max-w-300 items-center gap-2 px-4 md:h-16 md:gap-3 xl:px-0">
        <Link href="/" aria-label="SynapseDesk" className="mr-auto rounded-md">
          <Lockup className="hidden md:inline-flex" />
          <span className="inline-flex md:hidden">
            <Image
              src="/mark-light.svg"
              alt=""
              width={28}
              height={28}
              unoptimized
              priority
              className="dark:hidden"
            />
            <Image
              src="/mark-dark.svg"
              alt=""
              width={28}
              height={28}
              unoptimized
              priority
              className="hidden dark:block"
            />
          </span>
        </Link>
        <nav
          aria-label="Sections"
          className="hidden items-center gap-1 md:flex"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              {section.label}
            </a>
          ))}
        </nav>
        <Link
          href="/login"
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
            className: 'md:h-9 md:px-4',
          })}
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className={buttonVariants({
            size: 'sm',
            className: 'md:h-9 md:px-4',
          })}
        >
          Start free
        </Link>
        <span className="md:hidden">
          <LandingMenu />
        </span>
      </div>
    </header>
  );
}
