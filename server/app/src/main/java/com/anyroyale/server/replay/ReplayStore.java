package com.anyroyale.server.replay;

import com.anyroyale.server.util.Json;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Keeps the most recent replays in memory (bounded) and, when REPLAY_DIR is configured, also
 * writes each one as JSON. Render's free file system is ephemeral, so disk replays are a debugging
 * aid, not durable storage.
 */
public final class ReplayStore {

  private static final Logger log = LoggerFactory.getLogger(ReplayStore.class);
  private static final int MAX_IN_MEMORY = 200;

  private final Path dir;
  private final Map<String, Replay> recent =
      new LinkedHashMap<>(16, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Replay> eldest) {
          return size() > MAX_IN_MEMORY;
        }
      };

  public ReplayStore(Path dir) {
    this.dir = dir;
    if (dir != null) {
      try {
        Files.createDirectories(dir);
      } catch (IOException e) {
        log.warn("Cannot create replay dir {}: {}", dir, e.toString());
      }
    }
  }

  public synchronized void save(Replay replay) {
    recent.put(replay.matchId(), replay);
    if (dir != null) {
      try {
        Files.writeString(dir.resolve(replay.matchId() + ".json"), Json.write(replay));
      } catch (IOException e) {
        log.warn("Failed to write replay {}: {}", replay.matchId(), e.toString());
      }
    }
  }

  public synchronized Replay get(String matchId) {
    return recent.get(matchId);
  }

  public synchronized int size() {
    return recent.size();
  }
}
