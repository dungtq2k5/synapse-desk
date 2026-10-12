import { toast } from 'sonner';

/**
 * A destructive toast: it stays until dismissed, and is announced at once.
 * Sonner's region is polite, so the words also go to the page's assertive
 * region (`#announcer-assertive`, in the root layout).
 *
 * @example toastError('Couldn’t sign out', 'Check your connection and try again.', { label: 'Try again', onClick: signOut });
 */
export function toastError(
  title: string,
  description: string,
  action?: { label: string; onClick: () => void },
): void {
  toast.error(title, { description, action, duration: Infinity });
  announce(`${title}. ${description}`, 'assertive');
}

/**
 * Says something to a screen reader without showing it: through the page's
 * polite region by default, or its assertive one.
 */
export function announce(
  text: string,
  urgency: 'polite' | 'assertive' = 'polite',
): void {
  const region = document.getElementById(`announcer-${urgency}`);
  if (!region) return;
  // Cleared first, so the same words said twice are still announced twice.
  region.textContent = '';
  globalThis.setTimeout(() => {
    region.textContent = text;
  }, 50);
}
