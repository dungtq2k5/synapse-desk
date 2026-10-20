package com.synapsedesk.gateway.modules.feedback;

import com.synapsedesk.gateway.modules.feedback.dto.rest.SubmitFeedbackDto;
import java.math.BigDecimal;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/**
 * The feedback list's `rating` filter: a thumb by its value (`1`, `-1`, and
 * `1.0`, which is the same number), unlike Spring's default enum conversion by
 * constant name. Anything else fails conversion, a 400 that names the values.
 * A `Converter` bean, so Spring Boot registers it with MVC.
 */
@Component
public class RatingFilterConverter
  implements Converter<String, SubmitFeedbackDto.RatingEnum>
{

  @Override
  public SubmitFeedbackDto.RatingEnum convert(String value) {
    return SubmitFeedbackDto.RatingEnum.fromValue(new BigDecimal(value.trim()));
  }
}
