package com.anyroyale.server.match;

/** Exposes package-private MatchSession test hooks to tests in other packages. */
public final class TestAccess {
  private TestAccess() {}

  public static void step(MatchSession s) {
    s.stepForTests();
  }

  public static BattleSetup battle(MatchSession s) {
    return s.battleForTests();
  }
}
