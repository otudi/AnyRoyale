package com.anyroyale.server.bots;

import com.anyroyale.server.arenas.ArenaCatalog;
import com.anyroyale.server.cards.SharedRandomDeckGenerator;
import com.anyroyale.server.match.MatchConfig;
import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.match.MatchSession;
import com.anyroyale.server.match.TestAccess;
import com.anyroyale.server.replay.Replay;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

class BotDebugTest {
  static BotBrain logging(HeuristicBot bot, String tag, StringBuilder log) {
    return new BotBrain() {
      public Decision think(BotView v) {
        Decision d = bot.think(v);
        if (d != null) log.append(String.format("%5.1fs %-6s %-5s el=%.1f %-14s (%5d,%5d) %s%n", v.tick()/20.0, tag, v.team(), v.elixir(), d.cardId(), d.x(), d.y(), bot.lastReason));
        return d;
      }
      public String difficulty() { return bot.difficulty(); }
    };
  }

  @Test
  @EnabledIfEnvironmentVariable(named = "BOTDEBUG", matches = "true")
  void debug() {
    String a = System.getenv().getOrDefault("BOTA", "hard"), b = System.getenv().getOrDefault("BOTB", "easy");
    long seed = Long.parseLong(System.getenv().getOrDefault("SEED", "6001"));
    StringBuilder log = new StringBuilder();
    AtomicLong now = new AtomicLong();
    AtomicReference<Replay> ended = new AtomicReference<>();
    MatchSession.Listener l = new MatchSession.Listener() {
      public void onEnded(MatchSession s, Replay r) { ended.set(r); }
      public void onRematch(MatchSession s, boolean sd) {}
      public void onClosed(MatchSession s) {}
    };
    var deck = new SharedRandomDeckGenerator().generate(seed);
    MatchConfig cfg = new MatchConfig("d", seed, deck, ArenaCatalog.pick(seed), MatchMode.BOT, null);
    MatchSession s = new MatchSession(cfg, "A", a, logging(new HeuristicBot(BotProfile.of(a), 1), a, log),
        "B", b, logging(new HeuristicBot(BotProfile.of(b), 2), b, log), l, 30, 20, now::get);
    int guard = 0;
    while (s.state() != MatchSession.State.ENDED && guard++ < 20*60*8) {
      now.addAndGet(50); TestAccess.step(s);
      if (s.state()==MatchSession.State.RUNNING && TestAccess.battle(s).engine.getGameState().getFrameCount() % 600 == 0) {
        var gs = TestAccess.battle(s).engine.getGameState();
        StringBuilder t = new StringBuilder("   -- towers ");
        for (var team : org.crforge.core.player.Team.values()) for (var tw : gs.getTowers().get(team)) t.append(team).append(':').append(tw.getHealth().getCurrent()).append(' ');
        log.append(t).append('\n');
      }
    }
    System.out.println("DECK " + deck.cardIds());
    System.out.println(log);
    System.out.println("RESULT " + ended.get().result());
  }
}
