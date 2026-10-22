package com.synapsedesk.gateway.modules.organizations;

import com.synapsedesk.gateway.modules.organizations.dto.rest.UsageMeterResponseDto;
import java.math.BigDecimal;
import synapsedesk.auth.Organization.UsageMeter;

/** Usage meters off the wire, for the organization's usage page and the platform's. */
public final class UsageMeters {

  private UsageMeters() {}

  /** A meter as auth-service answered it. */
  public static UsageMeterResponseDto toDto(UsageMeter meter) {
    return new UsageMeterResponseDto()
      .available(meter.getAvailable())
      .used(
        meter.getAvailable() && meter.hasUsed()
          ? BigDecimal.valueOf(meter.getUsed())
          : null
      )
      .limit(
        meter.getAvailable() && meter.hasLimit()
          ? BigDecimal.valueOf(meter.getLimit())
          : null
      )
      .unavailableReason(
        meter.getAvailable() ? null : toUnavailableReason(meter)
      );
  }

  /** A meter whose service didn't answer: no number, never a zero. */
  public static UsageMeterResponseDto readFailed() {
    return new UsageMeterResponseDto()
      .available(false)
      .used(null)
      .limit(null)
      .unavailableReason(
        UsageMeterResponseDto.UnavailableReasonEnum.READ_FAILED
      );
  }

  /**
   * A meter's reason off the wire, as one of the codes. Anything else (an older
   * peer's sentence, or none) is {@code READ_FAILED}: the meter didn't answer.
   */
  private static UsageMeterResponseDto.UnavailableReasonEnum toUnavailableReason(
    UsageMeter meter
  ) {
    return "NOT_AVAILABLE".equals(meter.getUnavailableReason())
      ? UsageMeterResponseDto.UnavailableReasonEnum.NOT_AVAILABLE
      : UsageMeterResponseDto.UnavailableReasonEnum.READ_FAILED;
  }
}
