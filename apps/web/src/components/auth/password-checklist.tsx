import { CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { PASSWORD_RULES, type PasswordRule } from '@/lib/password-rules';

/**
 * The password rules, ticked as they're met: the one checklist every password
 * field shows (sign-up, a reset, a change, an invitation). Each rule's state
 * is in its accessible name, not its color alone.
 *
 * @example <PasswordChecklist value={password} />
 */
export function PasswordChecklist({
  value,
  rules = PASSWORD_RULES,
}: {
  value: string;
  rules?: PasswordRule[];
}) {
  return (
    <ul className="flex flex-col gap-1">
      {rules.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.label}
            aria-label={`${rule.label}, ${met ? 'met' : 'not met'}`}
            className="flex items-center gap-2"
          >
            {met ? (
              <CircleCheckIcon aria-hidden className="size-4 text-success" />
            ) : (
              <CircleXIcon aria-hidden className="size-4" />
            )}
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
