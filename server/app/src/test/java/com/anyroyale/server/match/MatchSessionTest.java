package com.anyroyale.server.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.arenas.ArenaCatalog;
import com.anyroyale.server.bots.BotFactory;
import com.anyroyale.server.cards.SharedRandomDeckGenerator;
import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.replay.Replay;
import com.anyroyale.server.replay.ReplayVerifier;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.crforge.core.card.Card;
import org.crforge.core.player.Team;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Drives MatchSession synchronously with a fake clock and fake connections. */
class MatchSessionTest {

  private final AtomicLong now = new AtomicLong(1_000_000);
  private final AtomicReference<Replay> ended = new AtomicReference<>();
  private final AtomicBoolean closed = new AtomicBoolean();
  private final AtomicBoolean rematch = new AtomicBoolean();
  private FakeChannel a;
  private FakeChannel b;
  private MatchSession session;

  private final MatchSession.Listener listener =
      new MatchSession.Listener() {
        @Override
        public void onEnded(MatchSession s, Replay r) {
          ended.set(r);
        }

        @Override
        public void onRematch(MatchSession s, boolean sameDeck) {
          rematch.set(true);
        }

        @Override
        public void onClosed(MatchSession s) {
          closed.set(true);
        }
      };

  @BeforeEach
  void setUp() {
    a = new FakeChannel("g_aaaaaaaaaaaaaa", "Alice");
    b = new FakeChannel("g_bbbbbbbbbbbbbb", "Bob");
    long seed = 12345;
    MatchConfig cfg =
        new MatchConfig(
            "m-test",
            seed,
            new SharedRandomDeckGenerator().generate(seed),
            ArenaCatalog.pick(seed),
            MatchMode.ONLINE,
            null);
    session =
        new MatchSession(cfg, a.guestId, a.name, null, b.guestId, b.name, null, listener, 30, 20, now::get);
    session.attach(a);
    session.attach(b);
  }

  private void step(int n) {
    for (int i = 0; i < n; i++) {
      now.addAndGet(MatchSession.TICK_MS);
      session.stepForTests();
    }
  }

  private void startBattle() {
    step(1);
    session.ready(a.guestId);
    session.ready(b.guestId);
    step(2 + 60);
    assertThat(session.state()).isEqualTo(MatchSession.State.RUNNING);
  }

  @Test
  void bothPlayersReceiveTheSameDeckArenaAndOpposingSeats() {
    step(1);
    JsonNode sa = a.last("matchStart");
    JsonNode sb = b.last("matchStart");
    assertThat(sa.get("deck")).isEqualTo(sb.get("deck"));
    assertThat(sa.get("arena")).isEqualTo(sb.get("arena"));
    assertThat(sa.get("seed").asText()).isEqualTo(sb.get("seed").asText());
    assertThat(sa.get("you").asText()).isNotEqualTo(sb.get("you").asText());
    assertThat(sa.path("opponent").path("name").asText()).isEqualTo("Bob");
  }

  @Test
  void snapshotsHideOpponentHandAndElixirAndShowTheSameBattlefield() {
    startBattle();
    step(4);
    JsonNode snapA = a.last("snap");
    JsonNode snapB = b.last("snap");
    assertThat(snapA.has("me")).isTrue();
    assertThat(snapA.path("opp").has("elixir")).isFalse();
    assertThat(snapA.path("opp").has("hand")).isFalse();
    assertThat(snapA.get("tick")).isEqualTo(snapB.get("tick"));
    assertThat(snapA.get("e")).isEqualTo(snapB.get("e"));
    assertThat(snapA.path("me").path("hand")).isEqualTo(snapB.path("me").path("hand"));
  }

  @Test
  void validPlayIsAcknowledgedAndSpawnsVisibleUnitsForBoth() {
    startBattle();
    step(20 * 3);
    Team aTeam = Team.valueOf(a.last("matchStart").get("you").asText());
    BattleSetup battle = session.battleForTests();
    int slot = cheapestTroopSlot(battle, aTeam);
    Card card = battle.player(aTeam).getHand().getCard(slot);
    int[] pos = aTeam == Team.BLUE ? new int[] {9000, 9000} : new int[] {9000, 23000};
    int before = a.last("snap").get("e").size();
    session.play(a.guestId, 1, slot, card.getId(), pos[0], pos[1]);
    step(2);
    assertThat(a.ofType("ack")).extracting(n -> n.get("seq").asLong()).contains(1L);
    step(20 * 3);
    assertThat(a.last("snap").get("e").size()).isGreaterThan(before);
    assertThat(b.last("snap").get("e")).isEqualTo(a.last("snap").get("e"));
  }

  @Test
  void illegalPlaysAreRejectedWithReasons() {
    startBattle();
    Team aTeam = Team.valueOf(a.last("matchStart").get("you").asText());
    BattleSetup battle = session.battleForTests();
    Card c0 = battle.player(aTeam).getHand().getCard(0);
    Card c1 = battle.player(aTeam).getHand().getCard(1);
    // wrong card for slot
    session.play(a.guestId, 1, 0, c1.getId().equals(c0.getId()) ? "zzz" : c1.getId(), 9000, 9000);
    // placement on the enemy side for a troop
    int enemyY = aTeam == Team.BLUE ? 25000 : 7000;
    session.play(a.guestId, 2, 0, c0.getId(), 9000, enemyY);
    step(3);
    assertThat(a.ofType("reject")).extracting(n -> n.get("reason").asText()).contains("staleHand");
    // drain elixir: play until rejected for elixir
    long seq = 10;
    for (int i = 0; i < 6; i++) {
      for (int s = 0; s < 4; s++) {
        Card c = battle.player(aTeam).getHand().getCard(s);
        session.play(a.guestId, seq++, s, c.getId(), aTeam == Team.BLUE ? 9000 : 9000, aTeam == Team.BLUE ? 9000 : 23000);
        step(1);
      }
    }
    assertThat(a.ofType("reject"))
        .extracting(n -> n.get("reason").asText())
        .contains("elixir");
    assertThat(battle.player(aTeam).getElixir().getCurrent()).isGreaterThanOrEqualTo(0f);
  }

  @Test
  void duplicateSequenceNumbersAreIgnored() {
    startBattle();
    step(20 * 5);
    Team aTeam = Team.valueOf(a.last("matchStart").get("you").asText());
    BattleSetup battle = session.battleForTests();
    Card c = battle.player(aTeam).getHand().getCard(0);
    int y = aTeam == Team.BLUE ? 9000 : 23000;
    session.play(a.guestId, 5, 0, c.getId(), 9000, y);
    session.play(a.guestId, 5, 0, c.getId(), 9000, y);
    session.play(a.guestId, 4, 0, c.getId(), 9000, y);
    step(3);
    assertThat(a.ofType("ack")).hasSize(1);
    assertThat(a.ofType("reject")).isEmpty();
  }

  @Test
  void strangerCannotActInTheMatch() {
    startBattle();
    session.play("g_cccccccccccccc", 1, 0, "knight", 9000, 9000);
    session.ready("g_cccccccccccccc");
    session.leave("g_cccccccccccccc");
    step(5);
    assertThat(session.state()).isEqualTo(MatchSession.State.RUNNING);
    assertThat(a.ofType("ack")).isEmpty();
  }

  @Test
  void surrenderEndsTheMatchForTheOpponent() {
    startBattle();
    session.leave(a.guestId);
    step(2);
    assertThat(session.state()).isEqualTo(MatchSession.State.ENDED);
    JsonNode endB = b.last("end");
    assertThat(endB.get("youWon").asBoolean()).isTrue();
    assertThat(endB.get("reason").asText()).isEqualTo("surrender");
    assertThat(a.last("end").get("youWon").asBoolean()).isFalse();
  }

  @Test
  void disconnectedPlayerCanResumeWithinGraceAndForfeitsAfterIt() {
    startBattle();
    a.open = false;
    session.detach(a);
    step(2);
    assertThat(b.last("opponentStatus").get("connected").asBoolean()).isFalse();
    // Reconnect with a new connection within the grace period.
    FakeChannel a2 = new FakeChannel(a.guestId, a.name);
    step(20 * 10);
    session.attach(a2);
    step(2);
    assertThat(a2.last("matchStart").get("resume").asBoolean()).isTrue();
    assertThat(a2.last("snap")).isNotNull();
    assertThat(b.last("opponentStatus").get("connected").asBoolean()).isTrue();
    // Disconnect again and stay away past the 30 s grace.
    a2.open = false;
    session.detach(a2);
    step(20 * 31);
    assertThat(session.state()).isEqualTo(MatchSession.State.ENDED);
    assertThat(b.last("end").get("reason").asText()).isEqualTo("disconnect");
    assertThat(b.last("end").get("youWon").asBoolean()).isTrue();
  }

  @Test
  void rematchNeedsBothPlayers() {
    startBattle();
    session.leave(b.guestId);
    step(2);
    session.requestRematch(a.guestId, false);
    step(2);
    assertThat(rematch.get()).isFalse();
    assertThat(b.last("rematchStatus").get("opponentWants").asBoolean()).isTrue();
    session.requestRematch(b.guestId, false);
    step(2);
    assertThat(rematch.get()).isTrue();
    assertThat(closed.get()).isTrue();
  }

  @Test
  void matchWithAMissingPlayerIsCancelledWithoutResult() {
    FakeChannel c = new FakeChannel("g_dddddddddddddd", "Dan");
    long seed = 9;
    MatchConfig cfg =
        new MatchConfig("m-x", seed, new SharedRandomDeckGenerator().generate(seed), ArenaCatalog.pick(seed), MatchMode.ONLINE, null);
    MatchSession s =
        new MatchSession(cfg, c.guestId, c.name, null, "g_eeeeeeeeeeeeee", "Eve", null, listener, 5, 20, now::get);
    s.attach(c);
    for (int i = 0; i < 20 * 7; i++) {
      now.addAndGet(MatchSession.TICK_MS);
      s.stepForTests();
    }
    assertThat(s.state()).isEqualTo(MatchSession.State.CLOSED);
    assertThat(c.last("matchCancelled")).isNotNull();
    assertThat(ended.get()).isNull();
  }

  /** A full bot-vs-human match where the human idles: the bot must win, and the replay verifies. */
  @Test
  void fullBotMatchCompletesAndItsReplayReproducesExactly() {
    FakeChannel h = new FakeChannel("g_hhhhhhhhhhhhhh", "Human");
    long seed = 777;
    MatchConfig cfg =
        new MatchConfig("m-bot", seed, new SharedRandomDeckGenerator().generate(seed), ArenaCatalog.pick(seed), MatchMode.BOT, "hard");
    MatchSession s =
        new MatchSession(cfg, h.guestId, h.name, null, "bot", "Bot", BotFactory.create("hard", 1), listener, 600, 20, now::get);
    s.attach(h);
    s.ready(h.guestId);
    int guard = 0;
    while (s.state() != MatchSession.State.ENDED && guard++ < 20 * 60 * 7) {
      now.addAndGet(MatchSession.TICK_MS);
      s.stepForTests();
    }
    assertThat(s.state()).isEqualTo(MatchSession.State.ENDED);
    Replay r = ended.get();
    assertThat(r).isNotNull();
    assertThat(r.result().winner()).isEqualTo("RED");
    assertThat(r.actions()).isNotEmpty();
    ReplayVerifier.Outcome o = ReplayVerifier.simulate(r);
    assertThat(ReplayVerifier.matches(r, o)).as("replay %s vs %s", r.result(), o).isTrue();
  }

  private static int cheapestTroopSlot(BattleSetup battle, Team team) {
    int best = 0;
    int bestCost = 99;
    for (int i = 0; i < 4; i++) {
      Card c = battle.player(team).getHand().getCard(i);
      if (c.getType() != org.crforge.core.card.CardType.SPELL && !c.isCanDeployOnEnemySide() && c.getCost() < bestCost) {
        best = i;
        bestCost = c.getCost();
      }
    }
    return best;
  }
}
