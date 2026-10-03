package com.synapsedesk.gateway.validation;

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
 * {@code class-validator}'s {@code @IsStrongPassword()} with its defaults, ported from
 * {@code validator.js} 13.15's {@code isStrongPassword}: at least 8 characters, and at
 * least one lowercase letter, one uppercase letter, one digit and one symbol.
 *
 * <p><b>What counts is exactly the library's.</b> A lowercase letter is {@code [a-z]},
 * an uppercase one {@code [A-Z]}, a digit {@code [0-9]}, and a symbol one of
 * {@code -#!$@£%^&*()_+|~=`{}[]:";'<>?,./\} or a space; any other character (an
 * accented letter, an emoji) counts toward the length and toward nothing else. The
 * length is the number of UTF-16 units, as JavaScript's {@code length} is. Held to the
 * library row for row by the shared parity table.
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
  String message() default "is not strong enough";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator implements ConstraintValidator<StrongPassword, String> {

    private static final int MIN_LENGTH = 8;
    private static final String SYMBOLS =
      "-#!$@£%^&*()_+|~=`{}[]:\";'<>?,./\\ ";

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || accepts(value);
    }

    public static boolean accepts(String value) {
      boolean lower = false;
      boolean upper = false;
      boolean digit = false;
      boolean symbol = false;
      for (int i = 0; i < value.length(); i++) {
        char c = value.charAt(i);
        if (c >= 'A' && c <= 'Z') upper = true;
        else if (c >= 'a' && c <= 'z') lower = true;
        else if (c >= '0' && c <= '9') digit = true;
        else if (SYMBOLS.indexOf(c) >= 0) symbol = true;
      }

      return value.length() >= MIN_LENGTH && lower && upper && digit && symbol;
    }
  }
}
