/** One rule of the new-password checklist. */
export type PasswordRule = {
  label: string;
  test: (password: string) => boolean;
};

/**
 * The symbols auth-service counts, exactly: `ResetPasswordDto.newPassword`'s
 * pattern in the API document. A character outside it (`€`, say) is not a
 * symbol there, so it doesn't tick the box here.
 */
const SYMBOL = /[-#!$@£%^&*()_+|~=`{}[\]:";'<>?,./\\ ]/;

/**
 * The checklist under "New password", in the order it's shown. Together they
 * are the server's rule, so a password that ticks all five is accepted.
 *
 * @example PASSWORD_RULES.every((rule) => rule.test('Correct-Horse1')) // true
 */
export const PASSWORD_RULES: PasswordRule[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A number', test: (p) => /[0-9]/.test(p) },
  { label: 'A symbol', test: (p) => SYMBOL.test(p) },
];
