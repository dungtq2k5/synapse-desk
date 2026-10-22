package com.synapsedesk.gateway.modules.platform.dto.rest;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.modules.organizations.dto.rest.OrganizationResponseDto;
import com.synapsedesk.gateway.modules.organizations.dto.rest.UsageMeterResponseDto;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/**
 * The platform console's response DTOs as values: two built alike are equal
 * with one hash, a changed field breaks equality, the required-parameter
 * constructor and the setters build what the fluent calls build, and
 * {@code toString} names every field (it's what a failed assertion prints).
 */
class PlatformResponseDtoValueTest {

  private static final OffsetDateTime DELETED = OffsetDateTime.of(
    2026,
    10,
    22,
    0,
    0,
    0,
    0,
    ZoneOffset.UTC
  );

  private static UsageMeterResponseDto meter(long used) {
    return new UsageMeterResponseDto()
      .available(true)
      .used(BigDecimal.valueOf(used))
      .limit(BigDecimal.TEN)
      .unavailableReason(null);
  }

  private static PlatformOrganizationUsageResponseDto usage() {
    return new PlatformOrganizationUsageResponseDto()
      .seats(meter(4))
      .storage(meter(5))
      .aiTokens(meter(6));
  }

  private static PlatformOrganizationDetailResponseDto detail() {
    return new PlatformOrganizationDetailResponseDto()
      .organization(new OrganizationResponseDto().id("org-1").name("Acme"))
      .userCount(BigDecimal.ONE)
      .pendingInvitationCount(BigDecimal.ZERO)
      .departmentCount(BigDecimal.TWO)
      .deletedAt(DELETED)
      .usage(usage());
  }

  private static SubscriptionPlanPriceResponseDto price() {
    return new SubscriptionPlanPriceResponseDto()
      .id("p1")
      .stripePriceId("price_monthly")
      .interval("month")
      .unitAmount(BigDecimal.valueOf(2_900))
      .currency("usd");
  }

  @Test
  void theUsageIsAValue() {
    assertThat(usage()).isEqualTo(usage()).hasSameHashCodeAs(usage());
    assertThat(usage().storage(meter(9))).isNotEqualTo(usage());
    assertThat(usage()).isNotEqualTo(null).isNotEqualTo("usage");

    PlatformOrganizationUsageResponseDto set =
      new PlatformOrganizationUsageResponseDto();
    set.setSeats(meter(4));
    set.setStorage(meter(5));
    set.setAiTokens(meter(6));
    assertThat(set).isEqualTo(usage());
    assertThat(
      new PlatformOrganizationUsageResponseDto(meter(4), meter(5), meter(6))
    ).isEqualTo(usage());
    assertThat(usage().toString()).contains("seats:", "storage:", "aiTokens:");
  }

  @Test
  void theDetailIsAValue() {
    PlatformOrganizationDetailResponseDto same = detail();
    assertThat(same).isEqualTo(same).isEqualTo(detail());
    assertThat(detail()).hasSameHashCodeAs(detail());
    assertThat(detail().usage(null)).isNotEqualTo(detail());
    assertThat(detail()).isNotEqualTo(null).isNotEqualTo("detail");

    PlatformOrganizationDetailResponseDto set =
      new PlatformOrganizationDetailResponseDto(
        new OrganizationResponseDto().id("org-1").name("Acme"),
        BigDecimal.ONE,
        BigDecimal.ZERO,
        BigDecimal.TWO,
        DELETED
      );
    set.setUsage(usage());
    assertThat(set).isEqualTo(detail());
    assertThat(detail().toString()).contains(
      "organization:",
      "userCount:",
      "deletedAt:",
      "usage:"
    );
  }

  @Test
  void aPriceIsAValue() {
    SubscriptionPlanPriceResponseDto same = price();
    assertThat(same).isEqualTo(same).isEqualTo(price());
    assertThat(price()).hasSameHashCodeAs(price());
    assertThat(price().currency("eur")).isNotEqualTo(price());
    assertThat(price()).isNotEqualTo(null).isNotEqualTo("price");

    SubscriptionPlanPriceResponseDto set = new SubscriptionPlanPriceResponseDto(
      "p1",
      "price_monthly",
      "month"
    );
    set.setUnitAmount(BigDecimal.valueOf(2_900));
    set.setCurrency("usd");
    assertThat(set).isEqualTo(price());
    assertThat(price().toString()).contains(
      "unitAmount: 2900",
      "currency: usd"
    );
  }
}
