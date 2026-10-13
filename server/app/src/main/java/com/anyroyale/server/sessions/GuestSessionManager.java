package com.anyroyale.server.sessions;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Account-free guest identities.
 *
 * <p>The server issues a random guest id plus a token {@code HMAC-SHA256(secret, id)}. The browser
 * keeps both in localStorage and presents them on every connection. The server stores nothing: a
 * token is valid if its HMAC matches, so identities survive reconnects without a database, and a
 * client cannot claim another guest's id (and therefore their match seat) without that guest's
 * token.
 */
public final class GuestSessionManager {

  private static final String ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
  private static final int ID_LENGTH = 14;

  private final SecretKeySpec key;
  private final SecureRandom random = new SecureRandom();

  public GuestSessionManager(String secret) {
    this.key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
  }

  /** A freshly issued identity. */
  public record GuestIdentity(String guestId, String token) {}

  public GuestIdentity issue() {
    StringBuilder sb = new StringBuilder("g_");
    for (int i = 0; i < ID_LENGTH; i++) {
      sb.append(ID_ALPHABET.charAt(random.nextInt(ID_ALPHABET.length())));
    }
    String id = sb.toString();
    return new GuestIdentity(id, sign(id));
  }

  /** Returns true if {@code token} was issued by this server for {@code guestId}. */
  public boolean verify(String guestId, String token) {
    if (guestId == null || token == null || !guestId.matches("g_[a-z0-9]{" + ID_LENGTH + "}")) {
      return false;
    }
    byte[] expected = sign(guestId).getBytes(StandardCharsets.US_ASCII);
    byte[] actual = token.getBytes(StandardCharsets.US_ASCII);
    return MessageDigest.isEqual(expected, actual);
  }

  private String sign(String guestId) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(key);
      byte[] digest = mac.doFinal(guestId.getBytes(StandardCharsets.UTF_8));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    } catch (NoSuchAlgorithmException | InvalidKeyException e) {
      throw new IllegalStateException("HmacSHA256 unavailable", e);
    }
  }

  /**
   * Normalises a display name: trims, collapses whitespace, strips control and markup characters
   * and limits the length. Letters from any script (Arabic included) are allowed. Returns null if
   * nothing usable remains.
   */
  public static String sanitizeName(String raw) {
    if (raw == null) {
      return null;
    }
    StringBuilder sb = new StringBuilder();
    raw.codePoints()
        .forEach(
            cp -> {
              if (Character.isLetterOrDigit(cp) || cp == '_' || cp == '-' || cp == '.') {
                sb.appendCodePoint(cp);
              } else if (Character.isWhitespace(cp) || Character.isSpaceChar(cp)) {
                sb.append(' ');
              }
            });
    String name = sb.toString().trim().replaceAll(" +", " ");
    if (name.codePointCount(0, name.length()) > 16) {
      name = name.substring(0, name.offsetByCodePoints(0, 16)).trim();
    }
    return name.codePointCount(0, name.length()) >= 2 ? name : null;
  }

  /** Server-side fallback name, used when a client sends none or an invalid one. */
  public String randomName() {
    return "Royal_" + (1000 + random.nextInt(9000));
  }
}
