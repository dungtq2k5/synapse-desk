package com.synapsedesk.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.ResponseCookie;

/**
 * What a response would actually carry, per cookie.
 *
 * <p>The row above binds milliseconds to a {@link Duration}; this one asks the
 * question a browser asks — the {@code Max-Age} on the wire, in SECONDS. It is
 * written against {@link ResponseCookie} rather than against arithmetic
 * because the conversion under test is the FRAMEWORK's, and a test that
 * divided by 1000 itself would pass while the framework did something else.
 *
 * <p>This is the slip that made the refresh cookie last 2 h 48 min instead of
 * 7 days: 604800 seconds handed to a field that wanted milliseconds. Here the
 * mistake runs the other way — milliseconds into a seconds field — and would
 * give a refresh cookie lasting 19 years.
 */
class CookieMaxAgeTest {

  /** name, the environment's milliseconds, the seconds a browser must see. */
  static List<Object[]> cookies() {
    return List.of(
        new Object[] {"COOKIE_ACCESS_MAX_AGE", 901_000L, 901L},
        new Object[] {"COOKIE_REFRESH_MAX_AGE", 604_801_000L, 604_801L},
        new Object[] {"COOKIE_2FA_MAX_AGE", 301_000L, 301L},
        new Object[] {"COOKIE_DEVICE_MAX_AGE", 2_592_000_000L, 2_592_000L},
        new Object[] {"COOKIE_TENANT_SELECTION_MAX_AGE", 300_000L, 300L});
  }

  @ParameterizedTest(name = "{0} = {1} ms is Max-Age={2}")
  @MethodSource("cookies")
  void writesSecondsOnTheWire(String key, long milliseconds, long seconds) {
    ResponseCookie cookie =
        ResponseCookie.from("probe", "value").maxAge(Duration.ofMillis(milliseconds)).build();

    assertThat(cookie.toString()).contains("Max-Age=" + seconds);
  }

  @Test
  void theEnvironmentStillCarriesMilliseconds() {
    // The premise every row above rests on. If `.env.example` ever switched to
    // seconds, those rows would keep passing against the wrong unit — this is
    // what fails instead.
    Map<String, String> environment = SharedEnvironment.values();

    assertThat(environment.get("COOKIE_REFRESH_MAX_AGE")).isEqualTo("604801000");
    assertThat(Long.parseLong(environment.get("COOKIE_ACCESS_MAX_AGE"))).isEqualTo(901_000L);
  }
}
