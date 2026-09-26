package com.synapsedesk.gateway.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.synapsedesk.gateway.config.JwtProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.text.ParseException;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * RS256 verification only — the gateway VERIFIES, never mints, exactly as
 * `jwt.strategy.ts` / `jwt-2fa.strategy.ts` do.
 *
 * <p><b>Two keys, loaded once.</b> The access and 2FA-challenge tokens are
 * signed by SEPARATE key pairs, so a challenge token cannot verify as an
 * access token — that separation is what stops a half-authenticated caller
 * reaching a route that requires a full session. Nimbus rather than
 * hand-rolled PEM/RSA: this is a trust-boundary security path.
 */
@Component
public class JwtVerifier {

  private final JWSVerifier accessVerifier;
  private final JWSVerifier twoFactorVerifier;

  public JwtVerifier(JwtProperties jwt) throws IOException, JOSEException {
    this.accessVerifier = verifierFor(jwt.accessPublicKeyPath());
    this.twoFactorVerifier = verifierFor(jwt.twoFactorPublicKeyPath());
  }

  /** The access cookie's token. Rejects a 2FA challenge token, like `JwtStrategy.validate`. */
  public Optional<JwtPrincipal> verifyAccess(String token) {
    return verify(token, accessVerifier)
        .filter(claims -> !isChallenge(claims))
        .map(this::toPrincipal);
  }

  /** The 2FA cookie's token. Rejects anything NOT marked as a challenge. */
  public Optional<JwtPrincipal> verifyTwoFactor(String token) {
    return verify(token, twoFactorVerifier)
        .filter(this::isChallenge)
        .map(this::toPrincipal);
  }

  private Optional<JWTClaimsSet> verify(String token, JWSVerifier verifier) {
    try {
      SignedJWT jwt = SignedJWT.parse(token);
      if (!jwt.verify(verifier)) {
        return Optional.empty();
      }

      JWTClaimsSet claims = jwt.getJWTClaimsSet();
      Date expiry = claims.getExpirationTime();
      // `ignoreExpiration: false` on the Node side — an expired token verifies
      // cryptographically and must still be refused.
      if (expiry != null && expiry.before(new Date())) {
        return Optional.empty();
      }

      return Optional.of(claims);
    } catch (ParseException | JOSEException malformedOrUnverifiable) {
      return Optional.empty();
    }
  }

  private boolean isChallenge(JWTClaimsSet claims) {
    return Boolean.TRUE.equals(claims.getClaim("is2faPending"));
  }

  @SuppressWarnings("unchecked")
  private JwtPrincipal toPrincipal(JWTClaimsSet claims) {
    return new JwtPrincipal(
        claims.getSubject(),
        (String) claims.getClaim("organizationId"),
        Boolean.TRUE.equals(claims.getClaim("isSuperAdmin")),
        (List<String>) claims.getClaim("departmentIds"),
        (List<String>) claims.getClaim("permissionCodes"),
        Boolean.TRUE.equals(claims.getClaim("isEmailVerified")),
        isChallenge(claims));
  }

  /**
   * Reads a PEM public key (`-----BEGIN PUBLIC KEY-----`) exactly as
   * `readFileSync(...)` hands Node's `jsonwebtoken` the raw bytes.
   */
  private static JWSVerifier verifierFor(String path) throws IOException, JOSEException {
    String pem = Files.readString(resolve(path));
    String base64 =
        pem.replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replaceAll("\\s", "");

    byte[] der = Base64.getDecoder().decode(base64);
    try {
      RSAPublicKey key =
          (RSAPublicKey)
              KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));

      return new RSASSAVerifier(key);
    } catch (java.security.GeneralSecurityException notAnRsaKey) {
      throw new JOSEException("not an RSA public key: " + path, notAnRsaKey);
    }
  }

  /** For a filter's own use — the algorithm every SignedJWT here must carry. */
  static final JWSAlgorithm ALGORITHM = JWSAlgorithm.RS256;

  /**
   * The configured path, as given — or, failing that, as it resolves from
   * one of two OTHER working directories a test can be run from.
   *
   * <p>In a real deployment `WORKDIR` is `/app` and `./secrets/jwt-access.pub`
   * resolves directly. Under `./mvnw test`, Maven's working directory is this
   * MODULE (`apps/api-gateway-java`), and the two `.env` files that can supply
   * this path disagree about what THEY are relative to, because each was
   * written for a different runner:
   *
   * <ul>
   *   <li>`.env.example`'s `./secrets/…` — measured — is relative to the
   *       NODE MODULE (`apps/api-gateway`, where the file actually lives),
   *       matching that gateway's own `WORKDIR`.
   *   <li>`.env.test`'s `./apps/api-gateway/test/fixtures/…` is relative to
   *       the REPO ROOT — the harness's own spawn `cwd` — the same
   *       convention `SharedEnvironment.ENV_EXAMPLE` already works around for
   *       that one file.
   * </ul>
   *
   * <p>So both siblings are tried, in addition to the path as given, before
   * giving up. This is dead code once every environment source normalizes on
   * one convention — `.env.test` is the harness's own file, not one this
   * module should have to accommodate forever.
   */
  private static Path resolve(String path) {
    List<Path> candidates =
        List.of(
            Path.of(path),
            Path.of("../api-gateway").resolve(path).normalize(),
            Path.of("../..").resolve(path).normalize());

    return candidates.stream()
        .filter(Files::exists)
        .findFirst()
        .orElseThrow(
            () ->
                new java.io.UncheckedIOException(
                    new java.io.IOException("none of " + candidates + " exists")));
  }
}
