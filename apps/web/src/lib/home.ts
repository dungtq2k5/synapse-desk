/**
 * Where someone's home is.
 *
 * @example home(false, true) // '/tickets'
 */
export function home(isSuperAdmin: boolean, isAgent: boolean): string {
  if (isSuperAdmin) return '/platform';
  return isAgent ? '/tickets' : '/ask';
}
