package com.anyroyale.server.bots;

/**
 * Decision-quality knobs. Every difficulty plays with identical rules, elixir, card levels and
 * tower stats; only how well the bot decides changes.
 *
 * @param thinkIntervalTicks how often the bot considers a move (20 ticks = 1 s)
 * @param reactionTicks how long an enemy unit must have been visible before the bot reacts to it
 * @param mistakeRate probability of replacing the best move with a random legal one
 * @param placementJitterTiles random error added to every placement
 * @param ignoreThreatRate probability of not noticing a threat on a given think
 * @param minAttackElixir elixir the bot saves before starting a push when not under pressure
 * @param spellValueRatio enemy elixir value a spell must hit, as a multiple of its cost
 * @param counterSelection pick the best counter card (false = any card that can engage)
 * @param buildingPull place buildings centrally to pull building-targeting units
 * @param avoidLeak spend elixir before it caps at 10
 * @param trackOpponent count opponent elixir and card cycle from their visible plays
 * @param supportPushes add support behind own units that survived defence (counter-push)
 * @param cheapCounters among adequate counters pick the cheapest (positive elixir trades)
 * @param defendUnderTower let ground troop-targeting threats walk into tower range first
 */
public record BotProfile(
    String name,
    int thinkIntervalTicks,
    int reactionTicks,
    double mistakeRate,
    double placementJitterTiles,
    double ignoreThreatRate,
    double minAttackElixir,
    double spellValueRatio,
    boolean counterSelection,
    boolean buildingPull,
    boolean avoidLeak,
    boolean trackOpponent,
    boolean supportPushes,
    boolean cheapCounters,
    boolean defendUnderTower) {

  public static final BotProfile EASY =
      new BotProfile("easy", 30, 36, 0.45, 2.5, 0.30, 4.0, 2.2, false, false, false, false, false, false, false);
  public static final BotProfile NORMAL =
      new BotProfile("normal", 16, 18, 0.15, 1.2, 0.06, 6.5, 1.5, true, false, true, false, true, false, false);
  public static final BotProfile HARD =
      new BotProfile("hard", 8, 10, 0.05, 0.5, 0.0, 7.0, 1.4, true, true, true, false, true, false, false);
  public static final BotProfile EXPERT =
      new BotProfile("expert", 3, 4, 0.0, 0.15, 0.0, 8.0, 1.7, true, true, true, true, true, true, true);

  public static BotProfile of(String difficulty) {
    if (difficulty == null) {
      return NORMAL;
    }
    return switch (difficulty.toLowerCase()) {
      case "easy" -> EASY;
      case "hard" -> HARD;
      case "expert" -> EXPERT;
      default -> NORMAL;
    };
  }
}
