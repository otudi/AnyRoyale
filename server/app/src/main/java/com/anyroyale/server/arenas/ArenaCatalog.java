package com.anyroyale.server.arenas;

import java.util.List;
import java.util.Random;

/**
 * Arenas available for random selection.
 *
 * <p>All arenas share the standard 18x32 battle layout simulated by crforge (tower positions,
 * river, bridges and lanes never change); an arena only selects the visual environment the client
 * renders. Every id here must have a matching theme in apps/web/src/rendering/arenaThemes.ts, which
 * the client verifies at start-up and the browser tests check, so the server never selects an
 * arena the client cannot draw.
 */
public final class ArenaCatalog {

  /** A selectable arena. {@code number} mirrors the ladder-arena numbering used in docs. */
  public record ArenaInfo(String id, int number, String name, String nameAr) {}

  private static final List<ArenaInfo> ARENAS =
      List.of(
          new ArenaInfo("meadow", 1, "Training Meadow", "مرج التدريب"),
          new ArenaInfo("goblin", 2, "Goblin Camp", "معسكر الغيلان"),
          new ArenaInfo("bones", 3, "Bone Yard", "ساحة العظام"),
          new ArenaInfo("sands", 4, "Sand Bowl", "الحلبة الرملية"),
          new ArenaInfo("arcane", 5, "Arcane Valley", "وادي السحر"),
          new ArenaInfo("frost", 6, "Frost Peak", "قمة الجليد"),
          new ArenaInfo("jungle", 7, "Jungle Ruins", "أطلال الغابة"),
          new ArenaInfo("highlands", 8, "Rocky Highlands", "المرتفعات الصخرية"));

  private ArenaCatalog() {}

  public static List<ArenaInfo> all() {
    return ARENAS;
  }

  public static ArenaInfo byId(String id) {
    return ARENAS.stream().filter(a -> a.id().equals(id)).findFirst().orElse(null);
  }

  /** Deterministic pick from a seed (the match seed mixed with a constant). */
  public static ArenaInfo pick(long seed) {
    Random r = new Random(seed ^ 0x5DEECE66DL ^ 0xA5E7A5E7L);
    return ARENAS.get(r.nextInt(ARENAS.size()));
  }
}
