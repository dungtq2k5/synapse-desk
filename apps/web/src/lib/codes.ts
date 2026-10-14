/** How long the resend link waits after a code is sent. */
export const RESEND_WAIT_SECONDS = 60;

/**
 * An email address masked as auth-service masks it: the first and last
 * letters of the name (just the first for one or two), and the domain.
 *
 * @example maskEmail('maya@northwind.health') // 'm***a@northwind.health'
 */
export function maskEmail(email: string): string {
  const [local = '', domain] = email.split('@');
  if (!domain) return '***';
  const visible =
    local.length <= 2
      ? `${local[0] ?? ''}***`
      : `${local[0]}***${local.at(-1)}`;
  return `${visible}@${domain}`;
}

/**
 * What a screen reader says for a masked address or number, rather than
 * "m asterisk asterisk asterisk a".
 *
 * @example maskedLabel('m***a@northwind.health') // 'an address starting with m and ending in a, at northwind.health'
 * @example maskedLabel('+44******1234') // 'a number ending in 1234'
 */
export function maskedLabel(masked: string): string {
  const email = /^(.)?\*+(.)?@(.+)$/.exec(masked);
  if (email) {
    const [, first, last, domain] = email;
    if (first && last) {
      return `an address starting with ${first} and ending in ${last}, at ${domain}`;
    }
    return first
      ? `an address starting with ${first}, at ${domain}`
      : `an address at ${domain}`;
  }
  const digits = /(\d{1,4})$/.exec(masked);
  return digits ? `a number ending in ${digits[1]}` : masked;
}

/**
 * Seconds as the resend line's countdown.
 *
 * @example countdown(45) // '0:45'
 * @example countdown(480) // '8:00'
 */
export function countdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The wrong-code line, with what's left.
 *
 * @example wrongCode(3) // 'That code is wrong. You have 3 attempts left.'
 * @example wrongCode(1) // 'That code is wrong. You have 1 attempt left.'
 */
export function wrongCode(attemptsRemaining: number): string {
  const attempts = attemptsRemaining === 1 ? 'attempt' : 'attempts';
  return `That code is wrong. You have ${attemptsRemaining} ${attempts} left.`;
}
