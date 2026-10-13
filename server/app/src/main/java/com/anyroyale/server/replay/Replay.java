package com.anyroyale.server.replay;

import java.util.List;

/**
 * Everything needed to re-simulate a match: the seed fixes deck, hands and arena; the accepted
 * actions are replayed at the engine frame where they were queued live.
 */
public record Replay(
    String matchId,
    String mode,
    long seed,
    String arenaId,
    List<String> deck,
    int level,
    String blueName,
    String redName,
    long startedAtEpochMs,
    List<Action> actions,
    Result result) {

  /** One accepted card play. {@code frame} is the engine frame count when it was queued. */
  public record Action(int frame, String team, int handIndex, String cardId, int x, int y) {}

  public record Result(
      String winner,
      boolean draw,
      String reason,
      int blueCrowns,
      int redCrowns,
      int blueTowerHp,
      int redTowerHp,
      int frames) {}
}
