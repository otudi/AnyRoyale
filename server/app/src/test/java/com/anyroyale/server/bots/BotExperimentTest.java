package com.anyroyale.server.bots;

import com.anyroyale.server.arenas.ArenaCatalog;
import com.anyroyale.server.cards.SharedRandomDeckGenerator;
import com.anyroyale.server.match.MatchConfig;
import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.match.MatchSession;
import com.anyroyale.server.match.TestAccess;
import com.anyroyale.server.replay.Replay;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Parameter experiments for tuning bots (run with BOTEXP=true; not part of CI). */
class BotExperimentTest {
  static final long SALT = Long.parseLong(System.getenv().getOrDefault("SALT", "0"));

  static int[] series(BotProfile a, BotProfile b, int n, long base) {
    int aw = 0, bw = 0;
    for (int i = 0; i < n; i++) {
      long seed = base + i;
      boolean aBlue = i % 2 == 0;
      AtomicLong now = new AtomicLong();
      AtomicReference<Replay> ended = new AtomicReference<>();
      MatchSession.Listener l = new MatchSession.Listener() {
        public void onEnded(MatchSession s, Replay r) { ended.set(r); }
        public void onRematch(MatchSession s, boolean sd) {}
        public void onClosed(MatchSession s) {}
      };
      MatchConfig cfg = new MatchConfig("x", seed, new SharedRandomDeckGenerator().generate(seed), ArenaCatalog.pick(seed), MatchMode.BOT, null);
      HeuristicBot ba = new HeuristicBot(a, seed * 31 + 1 + SALT), bb = new HeuristicBot(b, seed * 31 + 2 + SALT);
      MatchSession s = new MatchSession(cfg, "A", "a", aBlue ? ba : bb, "B", "b", aBlue ? bb : ba, l, 30, 20, now::get);
      int guard = 0;
      while (s.state() != MatchSession.State.ENDED && guard++ < 20 * 60 * 8) { now.addAndGet(50); TestAccess.step(s); }
      String w = ended.get().result().winner();
      if (w == null) continue;
      boolean aWon = w.equals("BLUE") == aBlue;
      if (aWon) aw++; else bw++;
    }
    return new int[] {aw, bw};
  }

  static BotProfile with(BotProfile p, String knob, double v) {
    return new BotProfile(p.name(),
        knob.equals("think") ? (int) v : p.thinkIntervalTicks(),
        knob.equals("react") ? (int) v : p.reactionTicks(),
        knob.equals("mistake") ? v : p.mistakeRate(),
        knob.equals("jitter") ? v : p.placementJitterTiles(),
        p.ignoreThreatRate(),
        knob.equals("attack") ? v : p.minAttackElixir(),
        knob.equals("spell") ? v : p.spellValueRatio(),
        knob.equals("counter") ? v > 0 : p.counterSelection(),
        knob.equals("pull") ? v > 0 : p.buildingPull(),
        p.avoidLeak(),
        knob.equals("track") ? v > 0 : p.trackOpponent(),
        knob.equals("support") ? v > 0 : p.supportPushes(),
        knob.equals("cheap") ? v > 0 : p.cheapCounters(),
        knob.equals("under") ? v > 0 : p.defendUnderTower());
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "BOTEXP", matches = "true")
  void experiments() {
    int n = Integer.parseInt(System.getenv().getOrDefault("N", "30"));
    String spec = System.getenv().getOrDefault("EXP", "base:0");
    Map<String, int[]> res = new LinkedHashMap<>();
    for (String e : spec.split(",")) {
      BotProfile cand = BotProfile.of(System.getenv().getOrDefault("BASE", "expert"));
      for (String part : e.split(";")) {
        String[] kv = part.split(":");
        if (!kv[0].equals("base")) cand = with(cand, kv[0], Double.parseDouble(kv[1]));
      }
      res.put(e, series(cand, BotProfile.of(System.getenv().getOrDefault("OPP", "normal")), n, 90000));
      System.out.println("EXP " + e + " vs normal: " + res.get(e)[0] + "-" + res.get(e)[1]);
    }
  }
}
