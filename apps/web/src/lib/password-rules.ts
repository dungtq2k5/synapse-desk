import { PASSWORD_POLICY } from '@synapsedesk/contracts';

/** One rule of the new-password checklist. */
export type PasswordRule = {
  label: string;
  test: (password: string) => boolean;
};

const SYMBOLS = new Set(PASSWORD_POLICY.symbols);

/** How many characters of `password` pass `test`. */
const count = (password: string, test: (character: string) => boolean) =>
  [...password].filter(test).length;

/**
 * The checklist under "New password", in the order it's shown: the platform's
 * `PASSWORD_POLICY`, the rule the gateway applies, so a password that ticks
 * all five is accepted. A symbol is one of the policy's `symbols`; `€` is not.
 *
 * @example PASSWORD_RULES.every((rule) => rule.test('Correct-Horse1')) // true
 */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    label: `At least ${PASSWORD_POLICY.minLength} characters`,
    test: (p) => p.length >= PASSWORD_POLICY.minLength,
  },
  {
    label: 'A lowercase letter',
    test: (p) =>
      count(p, (c) => /[a-z]/.test(c)) >= PASSWORD_POLICY.minLowercase,
  },
  {
    label: 'An uppercase letter',
    test: (p) =>
      count(p, (c) => /[A-Z]/.test(c)) >= PASSWORD_POLICY.minUppercase,
  },
  {
    label: 'A number',
    test: (p) => count(p, (c) => /[0-9]/.test(c)) >= PASSWORD_POLICY.minNumbers,
  },
  {
    label: 'A symbol',
    test: (p) => count(p, (c) => SYMBOLS.has(c)) >= PASSWORD_POLICY.minSymbols,
  },
];

/**
 * What a password still needs, as a sentence, or null when it meets every
 * rule: the error under a password field.
 *
 * @example passwordNeeds('Abcdefgh') // 'Your password needs a number and a symbol.'
 */
export function passwordNeeds(
  password: string,
  rules: PasswordRule[] = PASSWORD_RULES,
): string | null {
  const unmet = rules
    .filter((rule) => !rule.test(password))
    .map((rule) => rule.label.charAt(0).toLowerCase() + rule.label.slice(1));
  if (unmet.length === 0) return null;
  const list =
    unmet.length === 1
      ? unmet[0]
      : `${unmet.slice(0, -1).join(', ')} and ${unmet.at(-1)}`;
  return `Your password needs ${list}.`;
}
