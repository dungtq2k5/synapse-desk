package com.synapsedesk.gateway.modules.auditlogs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.ticket.Audit.AuditAction;
import synapsedesk.ticket.Audit.AuditResourceType;

/**
 * `AuditLogsApi` — the action/resourceType filter parsers. An unrecognized
 * value must 400,
 * never silently fall through to the proto's UNSPECIFIED zero value, which
 * the service reads as "no filter" — so an unrecognized filter would return
 * EVERYTHING and read as a match.
 */
class AuditLogsControllerTest {

  @Test
  void anAbsentActionMeansNoFilter() {
    assertThat(AuditLogsController.toAuditActionFilter(null)).isEqualTo(
      AuditAction.AUDIT_ACTION_UNSPECIFIED
    );
  }

  @Test
  void aRecognizedActionMapsThrough() {
    assertThat(
      AuditLogsController.toAuditActionFilter("USER_CREATED")
    ).isEqualTo(AuditAction.AUDIT_ACTION_USER_CREATED);
  }

  @Test
  void anUnrecognizedActionRefusesRatherThanSilentlyMatchingEverything() {
    assertThatThrownBy(() ->
      AuditLogsController.toAuditActionFilter("SOME_FUTURE_ACTION")
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void theLiteralUnspecifiedIsRefusedAsAFilterValue() {
    // UNSPECIFIED is the proto's "no filter" sentinel, never a value a client
    // may request explicitly, so it is outside the allowed set.
    assertThatThrownBy(() ->
      AuditLogsController.toAuditActionFilter("UNSPECIFIED")
    ).isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void aRecognizedResourceTypeMapsThrough() {
    assertThat(
      AuditLogsController.toResourceTypeFilter("DEPARTMENT")
    ).isEqualTo(AuditResourceType.AUDIT_RESOURCE_TYPE_DEPARTMENT);
  }

  @Test
  void anUnrecognizedResourceTypeRefuses() {
    assertThatThrownBy(() ->
      AuditLogsController.toResourceTypeFilter("NOT_A_REAL_TYPE")
    ).isInstanceOf(ResponseStatusException.class);
  }

  // `createExport`'s ISO-8601 check on `from`/`to` is `@StrictIso8601` on the DTO,
  // held by the body-date contract rows and the shared parity table — nothing left
  // to test at this file's level beyond the filter parsers above.
}
