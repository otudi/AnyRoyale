package com.anyroyale.server.match;

import java.util.List;
import java.util.Random;
import org.crforge.core.card.Card;
import org.crforge.core.engine.GameEngine;
import org.crforge.core.match.Standard1v1Match;
import org.crforge.core.player.Deck;
import org.crforge.core.player.LevelConfig;
import org.crforge.core.player.Player;
import org.crforge.core.player.Team;

/**
 * Builds a crforge engine for an AnyRoyale battle. Used by live matches and by replay
 * verification, so a replay is always simulated with exactly the live setup.
 *
 * <p>Fairness: both players receive the same {@link Deck} (same card order), the same card level,
 * the same tower level, and a hand built from {@code new Random(handSeed)} with the same seed, so
 * their four starting cards, the "next" card and the whole initial cycle are identical. Hands only
 * diverge once the players choose to play different cards.
 */
public final class BattleSetup {

  /** Card and tower level for every match (the classic tournament standard). */
  public static final int LEVEL = 11;

  /**
   * Seconds between a play and its units appearing (crforge's default is 1.0, a server-latency
   * buffer). 0.3 s still covers typical network latency, so the opponent sees the play before the
   * units act, while deploys feel immediate. Same for both seats.
   */
  public static final float PLACEMENT_DELAY = 0.3f;

  public final GameEngine engine;
  public final Standard1v1Match match;
  public final Player blue;
  public final Player red;

  private BattleSetup(GameEngine engine, Standard1v1Match match, Player blue, Player red) {
    this.engine = engine;
    this.match = match;
    this.blue = blue;
    this.red = red;
  }

  public static long handSeed(long matchSeed) {
    return matchSeed * 0x9E3779B97F4A7C15L + 0x632BE59BD9B4E019L;
  }

  public static BattleSetup create(long matchSeed, List<Card> deckCards, boolean blueBot, boolean redBot) {
    LevelConfig levels = new LevelConfig(LEVEL);
    long handSeed = handSeed(matchSeed);
    Player blue = new Player(Team.BLUE, new Deck(deckCards), blueBot, levels, new Random(handSeed));
    Player red = new Player(Team.RED, new Deck(deckCards), redBot, levels, new Random(handSeed));
    Standard1v1Match match = new Standard1v1Match(LEVEL);
    match.addPlayer(blue);
    match.addPlayer(red);
    GameEngine engine = new GameEngine();
    engine.useIsolatedEntityIds();
    engine.setPlacementSyncDelay(PLACEMENT_DELAY);
    engine.setMatch(match);
    engine.initMatch();
    return new BattleSetup(engine, match, blue, red);
  }

  public Player player(Team team) {
    return team == Team.BLUE ? blue : red;
  }
}
