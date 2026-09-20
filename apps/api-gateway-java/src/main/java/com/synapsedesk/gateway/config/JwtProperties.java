package com.synapsedesk.gateway.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Cookie NAMES and the public keys this gateway verifies with.
 *
 * <p><b>Two key paths, never a signing key.</b> The gateway verifies and
 * never mints, and the 2FA pair is separate from the access pair on purpose:
 * a challenge token must not verify where an access token is expected.
 *
 * <p>The {@link Pattern} is RFC 6265's {@code token} minus the separators,
 * and it is here for the reason the Node schema gives: an illegal cookie name
 * does not fail at boot on its own — it throws on the first login, so the
 * symptom is a 500 on the auth path pointing at the framework rather than at
 * the environment. A trailing {@code ;} is the easy typo and the worst one.
 *
 * @param accessName the access-token cookie
 * @param accessPublicKeyPath RS256 public half for the access pair
 * @param refreshName the refresh-token cookie
 * @param twoFactorName the 2FA CHALLENGE cookie ({@code JWT_2FA_NAME})
 * @param twoFactorPublicKeyPath public half for the 2FA pair
 * @param tenantSelectionName carries a multi-tenant login between its legs
 * @param deviceTokenName the remembered-device cookie
 */
@Validated
@ConfigurationProperties(prefix = "jwt")
public record JwtProperties(
    @NotBlank @Pattern(regexp = COOKIE_NAME, message = "is not a valid cookie name")
        String accessName,
    @NotBlank String accessPublicKeyPath,
    @NotBlank @Pattern(regexp = COOKIE_NAME, message = "is not a valid cookie name")
        String refreshName,
    @NotBlank @Pattern(regexp = COOKIE_NAME, message = "is not a valid cookie name")
        String twoFactorName,
    @NotBlank String twoFactorPublicKeyPath,
    @NotBlank @Pattern(regexp = COOKIE_NAME, message = "is not a valid cookie name")
        String tenantSelectionName,
    @NotBlank @Pattern(regexp = COOKIE_NAME, message = "is not a valid cookie name")
        String deviceTokenName) {

  /** RFC 6265 {@code token}: the same character class the Node schema uses. */
  static final String COOKIE_NAME = "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$";
}
