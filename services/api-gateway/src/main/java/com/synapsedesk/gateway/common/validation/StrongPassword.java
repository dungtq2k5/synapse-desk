package com.synapsedesk.gateway.common.validation;

import com.synapsedesk.gateway.common.contracts.PasswordPolicy;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The platform's password rule, {@code PASSWORD_POLICY} in {@code packages/contracts}: at
 * least 8 characters, and at least one lowercase letter, one uppercase letter, one digit
 * and one symbol, read through the generated {@link PasswordPolicy}. It is {@code
 * validator.js} 13.15's {@code isStrongPassword} with those options, ported.
 *
 * <p><b>What counts is exactly the library's.</b> A lowercase letter is {@code [a-z]},
 * an uppercase one {@code [A-Z]}, a digit {@code [0-9]}, and a symbol one of the policy's
 * {@code symbols} ({@code -#!$@£%^&*()_+|~=`{}[]:";'<>?,./\} and a space); any other
 * character (an accented letter, an emoji) counts toward the length and toward nothing
 * else. The length is the number of UTF-16 units, as JavaScript's {@code length} is. Held
 * to the library row for row by the shared parity table.
 *
 * <p>Example: {@code Str0ng!Passw0rd} passes; {@code weak} and {@code password1!} do not.
 */
@Documented
@Constraint(validatedBy = StrongPassword.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.METHOD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface StrongPassword {
  /**
   * The same rule as one ECMA-262 expression, for the published {@code pattern}: a
   * lookahead per character class, repeated for a minimum above one, and a length.
   * {@code [\s\S]} counts UTF-16 units, as the library's {@code length} does. The shared
   * parity table holds this expression to the library's answers row for row, so it is not
   * a second rule but a second spelling of the first, checked.
   */
  String REGEX = Validator.regex();

  String message() default "is not strong enough";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<StrongPassword, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || accepts(value);
    }

    public static boolean accepts(String value) {
      int lower = 0;
      int upper = 0;
      int digit = 0;
      int symbol = 0;
      for (int i = 0; i < value.length(); i++) {
        char c = value.charAt(i);
        if (c >= 'A' && c <= 'Z') upper++;
        else if (c >= 'a' && c <= 'z') lower++;
        else if (c >= '0' && c <= '9') digit++;
        else if (
          PasswordPolicy.PASSWORD_POLICY_SYMBOLS.indexOf(c) >= 0
        ) symbol++;
      }

      return (
        value.length() >= PasswordPolicy.PASSWORD_POLICY_MIN_LENGTH &&
        lower >= PasswordPolicy.PASSWORD_POLICY_MIN_LOWERCASE &&
        upper >= PasswordPolicy.PASSWORD_POLICY_MIN_UPPERCASE &&
        digit >= PasswordPolicy.PASSWORD_POLICY_MIN_NUMBERS &&
        symbol >= PasswordPolicy.PASSWORD_POLICY_MIN_SYMBOLS
      );
    }

    /** {@link #REGEX}, built from the policy. */
    static String regex() {
      String symbols = PasswordPolicy.PASSWORD_POLICY_SYMBOLS.replaceAll(
        "([\\\\\\-\\[\\]])",
        "\\\\$1"
      );
      return (
        "^" +
        atLeast(PasswordPolicy.PASSWORD_POLICY_MIN_LOWERCASE, "[a-z]") +
        atLeast(PasswordPolicy.PASSWORD_POLICY_MIN_UPPERCASE, "[A-Z]") +
        atLeast(PasswordPolicy.PASSWORD_POLICY_MIN_NUMBERS, "[0-9]") +
        atLeast(
          PasswordPolicy.PASSWORD_POLICY_MIN_SYMBOLS,
          "[" + symbols + "]"
        ) +
        "[\\s\\S]{" +
        PasswordPolicy.PASSWORD_POLICY_MIN_LENGTH +
        ",}$"
      );
    }

    /** A lookahead for {@code count} characters of {@code characterClass}. */
    private static String atLeast(int count, String characterClass) {
      return "(?=" + ("[\\s\\S]*" + characterClass).repeat(count) + ")";
    }
  }
}
