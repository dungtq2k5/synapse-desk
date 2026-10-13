package com.synapsedesk.gateway.common.validation;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.constraints.Size;
import java.lang.annotation.Annotation;
import java.net.URI;
import org.junit.jupiter.api.Test;

class UriSizeValidatorTest {

  private static final Size SIZE_2_TO_5 = new Size() {
    @Override
    public int min() {
      return 2;
    }

    @Override
    public int max() {
      return 5;
    }

    @Override
    public String message() {
      return "{jakarta.validation.constraints.Size.message}";
    }

    @Override
    public Class<?>[] groups() {
      return new Class<?>[0];
    }

    @Override
    public Class<? extends jakarta.validation.Payload>[] payload() {
      // Java has no generic array creation; an empty array holds nothing to mistype.
      @SuppressWarnings("unchecked")
      Class<? extends jakarta.validation.Payload>[] none =
        (Class<? extends jakarta.validation.Payload>[]) new Class<?>[0];
      return none;
    }

    @Override
    public Class<? extends Annotation> annotationType() {
      return Size.class;
    }
  };

  private final UriSizeValidator validator = new UriSizeValidator();

  @Test
  void nullPassesRegardlessOfBounds() {
    validator.initialize(SIZE_2_TO_5);

    assertThat(validator.isValid(null, null)).isTrue();
  }

  @Test
  void aUriWithinBoundsPasses() {
    validator.initialize(SIZE_2_TO_5);

    assertThat(validator.isValid(URI.create("abcd"), null)).isTrue();
  }

  @Test
  void aUriExactlyAtMinPasses() {
    validator.initialize(SIZE_2_TO_5);

    assertThat(validator.isValid(URI.create("ab"), null)).isTrue();
  }

  @Test
  void aUriExactlyAtMaxPasses() {
    validator.initialize(SIZE_2_TO_5);

    assertThat(validator.isValid(URI.create("abcde"), null)).isTrue();
  }

  @Test
  void aUriShorterThanMinFails() {
    validator.initialize(SIZE_2_TO_5);

    assertThat(validator.isValid(URI.create("a"), null)).isFalse();
  }

  @Test
  void aUriLongerThanMaxFails() {
    validator.initialize(SIZE_2_TO_5);

    assertThat(validator.isValid(URI.create("abcdef"), null)).isFalse();
  }
}
