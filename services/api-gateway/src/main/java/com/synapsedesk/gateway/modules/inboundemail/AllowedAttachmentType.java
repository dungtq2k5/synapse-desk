package com.synapsedesk.gateway.modules.inboundemail;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** The value is one of {@link InboundLimits#ALLOWED_ATTACHMENT_MIME_TYPES}. */
@Documented
@Constraint(validatedBy = AllowedAttachmentType.Validator.class)
@Target({
  ElementType.FIELD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
})
@Retention(RetentionPolicy.RUNTIME)
public @interface AllowedAttachmentType {
  String message() default "mimeType must be an allowed attachment type";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  class Validator
    implements ConstraintValidator<AllowedAttachmentType, String>
  {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return (
        value == null ||
        InboundLimits.ALLOWED_ATTACHMENT_MIME_TYPES.contains(value)
      );
    }
  }
}
