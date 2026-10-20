/**
 * Leaves the app with a full page load: for Stripe's Checkout and portal, and
 * for sign-in after signing out, where the query cache has to go with the page
 * (cleared in place, the shell's mounted queries refetch, get a 401, and send
 * the page to "Your session ended" instead). One function, so a spec can see
 * where the browser was sent.
 */
export function leaveFor(url: string): void {
  globalThis.location.assign(url);
}
