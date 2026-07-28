/**
 * Extract domain from email
 * @param email Email string
 * @returns Domain string or null if invalid email
 */
export function extractEmailDomain(email: string): string | null {
  if (!email) return null;

  const domain = email.split('@')[1];
  return domain || null;
}
