package com.synapsedesk.gateway.auth;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Node's {@code @IsISO8601({strict: true})}, reproduced — the fourth copy of
 * this check was the one that made it worth sharing: {@code
 * TicketsExportAndAiService}, {@code AuditLogsController}, {@code
 * PlatformJobsController} and {@code PlatformUsersRolesFinanceService} each
 * hand-replicated it independently, because the OpenAPI generator has no
 * spelling for {@code @IsISO8601} and drops it from every generated DTO —
 * generator-validation defect #3 (absent), the same shape each time.
 *
 * <p><b>Accepts a bare calendar date OR a full timestamp</b> — Node's
 * decorator delegates to {@code validator.js}'s {@code isISO8601}, which
 * genuinely accepts both regardless of the field's own custom message (e.g.
 * {@code BackfillJobDto}'s "{@code from must be YYYY-MM-DD}" describes the
 * expected shape, not the validator's actual acceptance). Two of the four
 * original copies validated only the bare-date form; unifying on the
 * broader one is a real widening for those two call sites, chasing Node's
 * behaviour rather than the narrower Java-only implementation.
 */
public final class IsoDateCheck {

  private IsoDateCheck() {}

  public static void requireIsoDate(String value, String field) {
    if (isValidIsoDate(value)) {
      return;
    }
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " must be a valid ISO 8601 date string");
  }

  private static boolean isValidIsoDate(String value) {
    try {
      OffsetDateTime.parse(value);
      return true;
    } catch (DateTimeParseException ignored) {
      // fall through — also accept a bare calendar date, matching Node's validator.js isISO8601
    }
    try {
      LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE);
      return true;
    } catch (DateTimeParseException ignored) {
      return false;
    }
  }
}
