/**
 * Leaves the app for another site in this tab: Stripe's Checkout and portal.
 * One function, so a spec can see where the browser was sent.
 */
export function leaveFor(url: string): void {
  globalThis.location.assign(url);
}
