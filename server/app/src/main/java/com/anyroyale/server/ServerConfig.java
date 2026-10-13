package com.anyroyale.server;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Runtime configuration, read from environment variables (Render injects {@code PORT}).
 *
 * @param host interface to bind; 0.0.0.0 in containers
 * @param port HTTP/WebSocket port
 * @param sessionSecret HMAC secret for guest tokens; random per process if unset
 * @param staticDir directory holding the built web client, or null to serve no static files
 * @param reconnectGraceSeconds how long a disconnected player keeps their seat
 * @param readyTimeoutSeconds how long a match waits for both clients to finish loading
 * @param maxMatches cap on concurrently running matches (protects small instances)
 * @param replayDir directory for replay JSON files, or null to keep replays in memory only
 * @param tickThreads number of threads that tick matches
 */
public record ServerConfig(
    String host,
    int port,
    String sessionSecret,
    Path staticDir,
    int reconnectGraceSeconds,
    int readyTimeoutSeconds,
    int maxMatches,
    Path replayDir,
    int tickThreads) {

  private static final Logger log = LoggerFactory.getLogger(ServerConfig.class);

  public static ServerConfig fromEnv() {
    return fromMap(System.getenv());
  }

  public static ServerConfig fromMap(Map<String, String> env) {
    String secret = env.getOrDefault("SESSION_SECRET", "");
    if (secret.isBlank()) {
      byte[] bytes = new byte[32];
      new SecureRandom().nextBytes(bytes);
      secret = HexFormat.of().formatHex(bytes);
      log.warn(
          "SESSION_SECRET is not set; generated a per-process secret. Guest tokens will not"
              + " survive a restart (players keep their names, but get new guest ids).");
    }
    Path staticDir = null;
    String staticEnv = env.getOrDefault("STATIC_DIR", "apps/web/dist");
    if (!staticEnv.isBlank() && Files.isDirectory(Path.of(staticEnv))) {
      staticDir = Path.of(staticEnv).toAbsolutePath();
    }
    String replayEnv = env.getOrDefault("REPLAY_DIR", "");
    Path replayDir = replayEnv.isBlank() ? null : Path.of(replayEnv).toAbsolutePath();
    int cores = Runtime.getRuntime().availableProcessors();
    return new ServerConfig(
        env.getOrDefault("HOST", "0.0.0.0"),
        intEnv(env, "PORT", 8080),
        secret,
        staticDir,
        intEnv(env, "RECONNECT_GRACE_SECONDS", 30),
        intEnv(env, "READY_TIMEOUT_SECONDS", 20),
        intEnv(env, "MAX_MATCHES", 200),
        replayDir,
        intEnv(env, "TICK_THREADS", Math.max(1, Math.min(4, cores))));
  }

  private static int intEnv(Map<String, String> env, String key, int fallback) {
    String value = env.get(key);
    if (value == null || value.isBlank()) {
      return fallback;
    }
    try {
      return Integer.parseInt(value.trim());
    } catch (NumberFormatException e) {
      log.warn("Ignoring non-numeric {}={}", key, value);
      return fallback;
    }
  }

  /** Configuration for tests: ephemeral port, fixed secret, short timeouts. */
  public static ServerConfig forTests(int reconnectGraceSeconds) {
    return new ServerConfig(
        "127.0.0.1", 0, "test-secret", null, reconnectGraceSeconds, 5, 50, null, 2);
  }
}
