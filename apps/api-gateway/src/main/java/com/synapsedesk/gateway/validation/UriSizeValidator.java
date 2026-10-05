package com.synapsedesk.gateway.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.constraints.Size;
import java.net.URI;

/**
 * Makes {@code @Size} work on a {@link URI} field — the length check runs
 * against the URI's string form, the same thing a {@code maxLength} on a
 * {@code format: uri} string schema means on the Node side.
 *
 * <p><b>Hibernate Validator ships no {@code @Size} validator for {@link
 * URI}</b> (only {@code CharSequence}, {@code Collection}, {@code Map} and
 * arrays), so a field typed as {@code URI} carrying {@code @Size} — the DTO
 * shape for a {@code format: uri} property that declares {@code maxLength},
 * where {@code @Size} is also what puts {@code maxLength} in the published
 * document — throws {@code UnexpectedTypeException} on every request that
 * reaches validation,
 * regardless of whether that field is even populated: a 500 on the whole
 * route, not a refusal of one bad value.
 *
 * <p>Registered as an ADDITIONAL validator for the existing {@code @Size}
 * constraint (see {@link ValidationConfig}), never a replacement — every
 * other {@code @Size} usage in this codebase (on {@code String}, {@code
 * List}, …) keeps its own built-in validator untouched.
 */
public class UriSizeValidator implements ConstraintValidator<Size, URI> {

  private int min;
  private int max;

  @Override
  public void initialize(Size constraintAnnotation) {
    this.min = constraintAnnotation.min();
    this.max = constraintAnnotation.max();
  }

  @Override
  public boolean isValid(
    URI value,
    jakarta.validation.ConstraintValidatorContext context
  ) {
    // `@NotNull` is a separate constraint; a `@Size`-only field is optional,
    // and Bean Validation's own convention is that every constraint but
    // `@NotNull` passes on null — the same reason `@Email` does.
    if (value == null) {
      return true;
    }

    int length = value.toString().length();
    return length >= min && length <= max;
  }
}
