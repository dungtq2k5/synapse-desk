import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Google's sign-in button, as Google's branding guidelines draw it: the
 * four-color "G", "Continue with Google" in Roboto Medium 14/20, 40 px tall,
 * a 1 px border and 4 px corners, on Google's light or dark surface. Not a
 * `Button`: its colors are Google's, through the `google-button` tokens. The
 * focus ring is the app's.
 */
export function GoogleButton({
  className,
  children = 'Continue with Google',
  ...props
}: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-[4px] border border-google-button-border bg-google-button-bg px-3 font-google text-sm/5 font-medium text-google-button-fg transition-all outline-none',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <GoogleLogo />
      {children}
    </button>
  );
}

/** Google's "G", from its sign-in button assets. */
function GoogleLogo() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-[18px] shrink-0">
      <path
        fill="var(--color-google-red)"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="var(--color-google-blue)"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="var(--color-google-yellow)"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="var(--color-google-green)"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
