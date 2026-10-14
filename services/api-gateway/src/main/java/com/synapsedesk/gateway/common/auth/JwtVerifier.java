package com.synapsedesk.gateway.common.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.synapsedesk.gateway.common.config.JwtProperties;
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
 * RS256 verification only — the gateway VERIFIES, never mints; auth-service
 * holds the private keys.
 *
 * <p><b>Two keys, loaded once.</b> The access and 2FA-challenge tokens are
 * signed by SEPARATE key pairs, so a challenge token cannot verify as an
 * access token — that separation is what stops a half-authenticated caller
 * reaching a route that requires a full session. Nimbus rather than
 * hand-rolled PEM/RSA: this is a trust-boundary security path.
 */
@Component
public class JwtVerifier {

  /**
   * The algorithm every token here must carry, refused otherwise before its
   * signature is checked: an RSA verifier also accepts RS384, RS512 and PS256
   * signatures from the same key, and auth-service issues only RS256.
   */
  static final JWSAlgorithm ALGORITHM = JWSAlgorithm.RS256;

  private final JWSVerifier accessVerifier;
  private final JWSVerifier twoFactorVerifier;

  public JwtVerifier(JwtProperties jwt) throws IOException, JOSEException {
    this.accessVerifier = verifierFor(jwt.accessPublicKeyPath());
    this.twoFactorVerifier = verifierFor(jwt.twoFactorPublicKeyPath());
  }

  /** The access cookie's token. Rejects a 2FA challenge token. */
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
      if (
        !ALGORITHM.equals(jwt.getHeader().getAlgorithm()) ||
        !jwt.verify(verifier)
      ) {
        return Optional.empty();
      }

      JWTClaimsSet claims = jwt.getJWTClaimsSet();
      Date expiry = claims.getExpirationTime();
      // An expired token verifies cryptographically and must still be refused.
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
      isChallenge(claims),
      claims.getClaim("sid") instanceof String sid ? sid : null
    );
  }

  /**
   * Reads a PEM public key (`-----BEGIN PUBLIC KEY-----`) from the file at
   * {@code path}, stripping the armour and decoding the X.509 DER body.
   */
  private static JWSVerifier verifierFor(String path)
    throws IOException, JOSEException {
    String pem = Files.readString(resolve(path));
    String base64 = pem
      .replace("-----BEGIN PUBLIC KEY-----", "")
      .replace("-----END PUBLIC KEY-----", "")
      .replaceAll("\\s", "");

    byte[] der = Base64.getDecoder().decode(base64);
    try {
      RSAPublicKey key = (RSAPublicKey) KeyFactory.getInstance(
        "RSA"
      ).generatePublic(new X509EncodedKeySpec(der));

      return new RSASSAVerifier(key);
    } catch (java.security.GeneralSecurityException notAnRsaKey) {
      throw new JOSEException("not an RSA public key: " + path, notAnRsaKey);
    }
  }

  /**
   * The configured path, as given — or, failing that, as it resolves from the
   * repository root.
   *
   * <p>In a real deployment `WORKDIR` is `/app`, and under `./mvnw` the working
   * directory is this module, `services/api-gateway`; `.env.example`'s
   * `./secrets/…` resolves directly in both. The contract harness's
   * `gateway.env` writes `./test/fixtures/…`, relative to the REPO ROOT, its
   * own spawn `cwd`; that is the one other place a path is tried.
   */
  private static Path resolve(String path) {
    List<Path> candidates = List.of(
      Path.of(path),
      Path.of("../..").resolve(path).normalize()
    );

    return candidates
      .stream()
      .filter(Files::exists)
      .findFirst()
      .orElseThrow(() ->
        new java.io.UncheckedIOException(
          new java.io.IOException("none of " + candidates + " exists")
        )
      );
  }
}
