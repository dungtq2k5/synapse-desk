import { Lockup } from '@/components/brand/lockup';

const LINK =
  'rounded-sm text-primary underline-offset-4 hover:underline focus-visible:underline';

/**
 * The footer: the lockup, "Built by dungtq2k5" (the name links to the
 * author's GitHub), the support address and the year. It sits at the bottom
 * of a short page too (`mt-auto` in a `min-h-svh` column).
 */
export function LandingFooter({ supportEmail }: { supportEmail: string }) {
  return (
    <footer className="mt-auto border-t px-4 py-8 md:py-10 xl:px-0">
      <div className="mx-auto flex max-w-300 flex-col gap-4 text-sm md:flex-row md:items-center md:gap-6">
        <Lockup className="md:mr-auto" />
        <p className="text-muted-foreground">
          Built by{' '}
          <a href="https://github.com/dungtq2k5" className={LINK}>
            dungtq2k5
          </a>
        </p>
        {supportEmail && (
          <a href={`mailto:${supportEmail}`} className={LINK}>
            {supportEmail}
          </a>
        )}
        <p className="text-muted-foreground">
          © {new Date().getFullYear()} SynapseDesk
        </p>
      </div>
    </footer>
  );
}
