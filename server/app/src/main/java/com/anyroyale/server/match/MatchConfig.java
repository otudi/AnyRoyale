package com.anyroyale.server.match;

import com.anyroyale.server.arenas.ArenaCatalog.ArenaInfo;
import com.anyroyale.server.cards.SharedRandomDeckGenerator.DeckSpec;

/**
 * Immutable description of a match, fixed by the server before the match starts. The seed alone
 * reproduces the deck, the starting hands and the arena.
 */
public record MatchConfig(
    String matchId, long seed, DeckSpec deck, ArenaInfo arena, MatchMode mode, String botDifficulty) {

  public enum MatchMode {
    ONLINE,
    PRIVATE,
    BOT;

    public String wire() {
      return name().toLowerCase();
    }
  }
}
