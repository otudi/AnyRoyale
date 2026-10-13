package com.anyroyale.server.bots;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.arenas.ArenaCatalog;
import com.anyroyale.server.cards.SharedRandomDeckGenerator;
import com.anyroyale.server.match.BattleSetup;
import com.anyroyale.server.match.MatchConfig;
import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.match.MatchSession;
import com.anyroyale.server.match.TestAccess;
import com.anyroyale.server.replay.Replay;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.crforge.core.player.Team;
import org.junit.jupiter.api.Test;

/**
 * Bots play complete matches against each other through the real MatchSession (same validation as
 * humans) and the stronger difficulty must win clearly more often. Also records per-difficulty
 * behaviour metrics (plays, elixir wasted at the cap) to show the levels differ in decisions.
 */
class BotTournamentTest {

  record MatchResult(String winnerDifficulty, Map<String, Stats> stats, Replay replay) {}

  static final class Stats {
    int plays;
    int ticksAtCap;
    int ticks;
  }

  static MatchResult play(String blueDiff, String redDiff, long seed) {
    AtomicLong now = new AtomicLong();
    AtomicReference<Replay> ended = new AtomicReference<>();
    MatchSession.Listener l =
        new MatchSession.Listener() {
          @Override
          public void onEnded(MatchSession s, Replay r) {
            ended.set(r);
          }

          @Override
          public void onRematch(MatchSession s, boolean sameDeck) {}

          @Override
          public void onClosed(MatchSession s) {}
        };
    MatchConfig cfg =
        new MatchConfig(
            "t" + seed,
            seed,
            new SharedRandomDeckGenerator().generate(seed),
            ArenaCatalog.pick(seed),
            MatchMode.BOT,
            null);
    MatchSession s =
        new MatchSession(
            cfg,
            "botA",
            blueDiff,
            BotFactory.create(blueDiff, seed * 31 + 1),
            "botB",
            redDiff,
            BotFactory.create(redDiff, seed * 31 + 2),
            l,
            30,
            20,
            now::get);
    Map<String, Stats> stats = new LinkedHashMap<>();
    stats.put("BLUE", new Stats());
    stats.put("RED", new Stats());
    int guard = 0;
    while (s.state() != MatchSession.State.ENDED && guard++ < 20 * 60 * 8) {
      now.addAndGet(MatchSession.TICK_MS);
      TestAccess.step(s);
      if (s.state() == MatchSession.State.RUNNING) {
        BattleSetup b = TestAccess.battle(s);
        for (Team t : Team.values()) {
          Stats st = stats.get(t.name());
          st.ticks++;
          if (b.player(t).getElixir().getCurrent() >= 9.99f) {
            st.ticksAtCap++;
          }
        }
      }
    }
    Replay r = ended.get();
    assertThat(r).as("match %d must finish", seed).isNotNull();
    for (Replay.Action a : r.actions()) {
      stats.get(a.team()).plays++;
    }
    String winner =
        r.result().winner() == null ? null : r.result().winner().equals("BLUE") ? blueDiff : redDiff;
    return new MatchResult(winner, stats, r);
  }

  /** Plays n matches alternating seats; returns wins of {@code strong}, wins of {@code weak}. */
  static int[] series(String strong, String weak, int n, long baseSeed, Map<String, double[]> metrics) {
    int strongWins = 0;
    int weakWins = 0;
    for (int i = 0; i < n; i++) {
      boolean strongBlue = i % 2 == 0;
      MatchResult m =
          play(strongBlue ? strong : weak, strongBlue ? weak : strong, baseSeed + i);
      if (strong.equals(m.winnerDifficulty())) {
        strongWins++;
      } else if (weak.equals(m.winnerDifficulty())) {
        weakWins++;
      }
      Stats ss = m.stats().get(strongBlue ? "BLUE" : "RED");
      Stats ws = m.stats().get(strongBlue ? "RED" : "BLUE");
      metrics.computeIfAbsent(strong, k -> new double[3]);
      metrics.computeIfAbsent(weak, k -> new double[3]);
      add(metrics.get(strong), ss);
      add(metrics.get(weak), ws);
    }
    return new int[] {strongWins, weakWins};
  }

  private static void add(double[] acc, Stats s) {
    acc[0] += s.plays;
    acc[1] += s.ticks == 0 ? 0 : 100.0 * s.ticksAtCap / s.ticks;
    acc[2] += 1;
  }

  /**
   * Bots are seeded, matches are deterministic, so these fixed seeds always give the same result:
   * the test is a regression guard, not a flaky statistical check.
   */
  @Test
  void strongerDifficultiesWinMore() {
    Map<String, double[]> metrics = new LinkedHashMap<>();
    int n = 30;
    int[] expertVsHard = series("expert", "hard", n, 90000, metrics);
    int[] hardVsNormal = series("hard", "normal", n, 90000, metrics);
    int[] normalVsEasy = series("normal", "easy", n, 90000, metrics);
    int[] expertVsEasy = series("expert", "easy", n, 90000, metrics);

    StringBuilder report = new StringBuilder("\nBot tournament (" + n + " matches per pairing, seats alternate)\n");
    report.append(String.format("expert vs hard   : %d-%d%n", expertVsHard[0], expertVsHard[1]));
    report.append(String.format("hard vs normal   : %d-%d%n", hardVsNormal[0], hardVsNormal[1]));
    report.append(String.format("normal vs easy   : %d-%d%n", normalVsEasy[0], normalVsEasy[1]));
    report.append(String.format("expert vs easy   : %d-%d%n", expertVsEasy[0], expertVsEasy[1]));
    for (Map.Entry<String, double[]> e : metrics.entrySet()) {
      double[] v = e.getValue();
      report.append(
          String.format(
              "%-7s avg plays/match %.1f, time at 10 elixir %.1f%%%n",
              e.getKey(), v[0] / v[2], v[1] / v[2]));
    }
    System.out.println(report);

    assertThat(expertVsHard[0]).as(report.toString()).isGreaterThan(expertVsHard[1]);
    assertThat(hardVsNormal[0]).as(report.toString()).isGreaterThan(hardVsNormal[1]);
    assertThat(normalVsEasy[0]).as(report.toString()).isGreaterThan(normalVsEasy[1]);
    assertThat(expertVsEasy[0]).as(report.toString()).isGreaterThanOrEqualTo((int) (n * 0.75));
  }
}
