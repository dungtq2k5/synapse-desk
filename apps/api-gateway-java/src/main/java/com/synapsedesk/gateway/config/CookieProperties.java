package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.convert.DurationUnit;
import org.springframework.validation.annotation.Validated;

/**
 * Cookie lifetimes, converted from milliseconds to a {@link Duration} ONCE —
 * here, at the binding.
 *
 * <p><b>The unit differs on each side of the port.</b> The environment carries
 * MILLISECONDS, because that is what Express's {@code maxAge} takes; the wire
 * carries SECONDS, and so does {@code ResponseCookie.maxAge(Duration)}. A
 * conversion done at each call site is a conversion that will be forgotten at
 * one of them, and the symptom is not an error: it is a cookie with the wrong
 * lifetime. That is how the refresh cookie once lasted 2 h 48 min instead of
 * 7 days — a millisecond value handed to a seconds field.
 *
 * <p>{@link DurationUnit} states the unit rather than establishing it:
 * measured by removing it, a bare number binds as MILLISECONDS either way,
 * because that is Spring's default for an unsuffixed {@code Duration}. So no
 * test here can fail on its removal — it is kept because a reader of
 * {@code COOKIE_REFRESH_MAX_AGE = 604801000} should not have to know the
 * default, and because a future change to that default would otherwise
 * silently re-scale every cookie. Values with an explicit suffix bind too, so
 * {@code 604800000} and {@code 7d} are the same lifetime.
 *
 * @param accessMaxAge access-token lifetime
 * @param refreshMaxAge refresh-token lifetime
 * @param twoFactorMaxAge 2FA challenge lifetime
 * @param deviceMaxAge remembered-device lifetime
 * @param tenantSelectionMaxAge tenant-selection lifetime
 * @param sameSite the SameSite policy every cookie is set with
 */
@Validated
@ConfigurationProperties(prefix = "cookie")
public record CookieProperties(
    @NotNull @DurationUnit(ChronoUnit.MILLIS) Duration accessMaxAge,
    @NotNull @DurationUnit(ChronoUnit.MILLIS) Duration refreshMaxAge,
    @NotNull @DurationUnit(ChronoUnit.MILLIS) Duration twoFactorMaxAge,
    @NotNull @DurationUnit(ChronoUnit.MILLIS) Duration deviceMaxAge,
    @NotNull @DurationUnit(ChronoUnit.MILLIS) Duration tenantSelectionMaxAge,
    @NotBlank String sameSite) {}
