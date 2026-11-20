/**
 * The `warning` a two-step sign-in answered with (few backup codes left),
 * carried from the sign-in page into the app, which shows it until dismissed.
 * Kept for this tab only.
 */
const KEY = 'synapsedesk:two-step-warning';

export function keepTwoStepWarning(warning: string): void {
  sessionStorage.setItem(KEY, warning);
}

export function readTwoStepWarning(): string | null {
  return sessionStorage.getItem(KEY);
}

export function dismissTwoStepWarning(): void {
  sessionStorage.removeItem(KEY);
}
