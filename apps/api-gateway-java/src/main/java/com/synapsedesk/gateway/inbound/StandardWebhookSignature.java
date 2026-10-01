package com.synapsedesk.gateway.inbound;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * The Standard Webhooks (svix) signature Resend signs a delivery with:
 * {@code v1,<base64 HMAC-SHA256>} over {@code "<id>.<timestamp>.<raw body>"},
 * keyed by the webhook secret's bytes after its {@code whsec_} prefix is stripped
 * and base64-decoded.
 *
 * <p>Checked over the EXACT bytes received, never a re-serialisation: a body that
 * is parsed and written back differs in whitespace, and the signature with it. The
 * header may carry several space-separated signatures (a secret being rotated);
 * any one matching is enough. The timestamp must be within five minutes either
 * way, which is what stops a captured delivery being replayed later.
 */
public final class StandardWebhookSignature {

  private static final String SCHEME = "v1,";
  private static final long TOLERANCE_SECONDS = 300;

  private StandardWebhookSignature() {}

  public static boolean verify(
    byte[] body,
    String id,
    String timestamp,
    String signatureHeader,
    String secret,
    Instant now
  ) {
    long timestampSeconds;
    try {
      timestampSeconds = Long.parseLong(timestamp);
    } catch (NumberFormatException notANumber) {
      return false;
    }
    if (Math.abs(now.getEpochSecond() - timestampSeconds) > TOLERANCE_SECONDS) {
      return false;
    }

    byte[] expected = sign(body, id, timestamp, secret);

    for (String token : signatureHeader.split(" ")) {
      if (!token.startsWith(SCHEME)) continue;
      byte[] candidate;
      try {
        candidate = Base64.getDecoder().decode(
          token.substring(SCHEME.length())
        );
      } catch (IllegalArgumentException notBase64) {
        continue;
      }
      if (MessageDigest.isEqual(expected, candidate)) return true;
    }

    return false;
  }

  private static byte[] sign(
    byte[] body,
    String id,
    String timestamp,
    String secret
  ) {
    byte[] key = Base64.getDecoder().decode(secret.replaceFirst("^whsec_", ""));
    byte[] prefix = (id + "." + timestamp + ".").getBytes(
      StandardCharsets.UTF_8
    );
    byte[] content = new byte[prefix.length + body.length];
    System.arraycopy(prefix, 0, content, 0, prefix.length);
    System.arraycopy(body, 0, content, prefix.length, body.length);

    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));

      return mac.doFinal(content);
    } catch (NoSuchAlgorithmException | InvalidKeyException failure) {
      throw new IllegalStateException("HmacSHA256 is not available", failure);
    }
  }
}
