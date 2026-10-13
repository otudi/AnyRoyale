package com.anyroyale.server.match;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import org.crforge.core.entity.projectile.Projectile;
import org.crforge.core.player.Team;

/**
 * Tells the client which card a source-less projectile belongs to, so it can draw a Fireball as a
 * fireball and Arrows as arrows. crforge spell projectiles carry no card reference, so the server
 * matches each new spell projectile to the most recent spell played by the same team, preferring
 * one aimed at the projectile's destination. Purely presentational: it has no effect on simulation.
 */
final class SpellAttribution {

  private record Play(Team team, String cardId, int x, int y, int tick) {}

  private static final int WINDOW_TICKS = 20 * 6;
  private static final long NEAR_SQ = 2500L * 2500L;

  private final Deque<Play> recent = new ArrayDeque<>();
  private final Map<Long, String> byProjectile = new HashMap<>();
  private int currentTick;

  void onSpellPlayed(Team team, String cardId, int x, int y, int tick) {
    recent.addFirst(new Play(team, cardId, x, y, tick));
    while (recent.size() > 16) {
      recent.removeLast();
    }
  }

  void setTick(int tick) {
    this.currentTick = tick;
    recent.removeIf(p -> currentTick - p.tick() > WINDOW_TICKS);
    if (byProjectile.size() > 512) {
      byProjectile.clear();
    }
  }

  String cardFor(Projectile p) {
    String cached = byProjectile.get(p.getId());
    if (cached != null) {
      return cached;
    }
    String found = "spell";
    Play fallback = null;
    for (Play play : recent) {
      if (play.team() != p.getTeam()) {
        continue;
      }
      if (fallback == null) {
        fallback = play;
      }
      long dx = (long) play.x() - p.getTargetX();
      long dy = (long) play.y() - p.getTargetY();
      if (dx * dx + dy * dy <= NEAR_SQ) {
        found = play.cardId();
        fallback = null;
        break;
      }
    }
    if (fallback != null) {
      found = fallback.cardId();
    }
    byProjectile.put(p.getId(), found);
    return found;
  }
}
