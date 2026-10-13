package com.anyroyale.server.cards;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.crforge.core.card.Card;
import org.crforge.core.card.CardType;
import org.crforge.data.card.CardRegistry;

/**
 * The cards that may appear in AnyRoyale matches.
 *
 * <p>crforge's cards.json holds 240 entries, but that is not the number of playable cards: it also
 * contains sub-entities (bombs, containers), evolution and hero variants, champions without their
 * ability cycling, and special game-mode buildings. A card enters the pool only if upstream marks it
 * {@code DONE} in docs/card_tracker.md (pinned copy: server/engine/UPSTREAM_CARD_TRACKER.md) and it
 * passes AnyRoyale's own deploy smoke test (CardPoolSmokeTest), which deploys every pool card in a
 * real match and checks that it produces live entities or effects without errors.
 *
 * <p>Excluded on purpose, with the reason recorded in docs/CARD_SUPPORT.md:
 *
 * <ul>
 *   <li>Champions (HERO type): ability cycling is not implemented upstream.
 *   <li>Evolutions ({@code _ev1}) and hero variants ({@code _hero}): data only; the evolution cycle
 *       counter and their special abilities are not implemented upstream.
 *   <li>Three Musketeers, Cannon Cart, Barbarian Launcher, Goblin Party Hut, Elixir Barrel, Dark
 *       Elixir Bottle: not tracked as DONE upstream.
 * </ul>
 */
public final class CardPool {

  /** Upstream DONE cards (internal ids), in tracker order. */
  private static final List<String> DONE_IDS =
      List.of(
          // Troops
          "knight", "archer", "goblins", "giant", "pekka", "minions", "balloon", "witch",
          "barbarians", "golem", "skeletons", "valkyrie", "skeletonarmy", "bomber", "musketeer",
          "babydragon", "prince", "wizard", "minipekka", "speargoblins", "giantskeleton",
          "hogrider", "minionhorde", "icewizard", "royalgiant", "skeletonwarriors", "princess",
          "darkprince", "lavahound", "icespirits", "firespirits", "miner", "zapmachine", "bowler",
          "ragebarbarian", "battleram", "infernodragon", "icegolemite", "megaminion",
          "blowdartgoblin", "goblingang", "electrowizard", "angrybarbarians", "hunter", "axeman",
          "assassin", "royalrecruits", "darkwitch", "bats", "ghost", "ramrider", "minisparkys",
          "rascals", "megaknight", "skeletonballoon", "dartbarrell", "wallbreakers", "royalhogs",
          "goblingiant", "fisherman", "elitearcher", "electrodragon", "firecracker", "elixirgolem",
          "battlehealer", "skeletondragons", "witchmother", "electrospirit", "electrogiant",
          "phoenix", "suspiciousbush", "berserker", "goblindemolisher", "giantbuffer",
          "goblinmachine", "mergemaiden",
          // Spells
          "fireball", "arrows", "rage", "rocket", "goblinbarrel", "freeze", "mirror", "lightning",
          "zap", "poison", "graveyard", "log", "tornado", "clone", "earthquake", "barblog", "heal",
          "snowball", "royaldelivery", "darkmagic", "goblincurse", "vines",
          // Buildings
          "cannon", "goblinhut_rework", "mortar", "infernotower", "bombtower", "barbarianhut",
          "tesla", "elixircollector", "xbow", "tombstone", "firespirithut", "goblincage",
          "goblindrill");

  /** Cards removed from the pool after AnyRoyale's own verification (id -> reason). */
  private static final Map<String, String> DISABLED = Map.of();

  private static final List<Card> CARDS;
  private static final Map<String, Card> BY_ID;

  static {
    List<Card> cards = new ArrayList<>();
    Map<String, Card> byId = new LinkedHashMap<>();
    for (String id : DONE_IDS) {
      if (DISABLED.containsKey(id)) {
        continue;
      }
      Card card = CardRegistry.get(id);
      if (card == null) {
        throw new IllegalStateException("Card pool references unknown card id: " + id);
      }
      if (card.getType() == CardType.HERO || card.getCost() <= 0) {
        throw new IllegalStateException("Card pool contains a non-playable card: " + id);
      }
      cards.add(card);
      byId.put(id, card);
    }
    CARDS = Collections.unmodifiableList(cards);
    BY_ID = Collections.unmodifiableMap(byId);
  }

  private CardPool() {}

  public static List<Card> all() {
    return CARDS;
  }

  public static Card get(String id) {
    return BY_ID.get(id);
  }

  public static boolean contains(String id) {
    return BY_ID.containsKey(id);
  }

  public static int size() {
    return CARDS.size();
  }

  public static Set<String> ids() {
    return BY_ID.keySet();
  }

  public static Map<String, String> disabled() {
    return DISABLED;
  }
}
