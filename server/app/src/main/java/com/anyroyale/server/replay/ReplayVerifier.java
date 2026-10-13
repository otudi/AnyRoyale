package com.anyroyale.server.replay;

import com.anyroyale.server.cards.CardPool;
import com.anyroyale.server.match.BattleSetup;
import java.util.ArrayList;
import java.util.List;
import org.crforge.core.card.Card;
import org.crforge.core.engine.GameState;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.player.Team;
import org.crforge.core.player.dto.PlayerActionDTO;

/**
 * Re-simulates a replay from its seed and recorded actions and reports whether the outcome matches
 * the live match. Matches decided by the engine (not by surrender/disconnect) must reproduce
 * exactly: same winner, same crowns, same tower hit points, same final frame.
 */
public final class ReplayVerifier {

  private ReplayVerifier() {}

  public record Outcome(
      String winner,
      boolean draw,
      int blueCrowns,
      int redCrowns,
      int blueTowerHp,
      int redTowerHp,
      int frames) {}

  public static Outcome simulate(Replay replay) {
    List<Card> deck = new ArrayList<>();
    for (String id : replay.deck()) {
      deck.add(CardPool.get(id));
    }
    BattleSetup b = BattleSetup.create(replay.seed(), deck, false, false);
    int next = 0;
    List<Replay.Action> actions = replay.actions();
    int maxFrames = replay.result() != null ? replay.result().frames() + 1 : 20 * 60 * 6;
    while (b.engine.isRunning() && b.engine.getGameState().getFrameCount() < maxFrames) {
      int frame = b.engine.getGameState().getFrameCount();
      while (next < actions.size() && actions.get(next).frame() == frame) {
        Replay.Action a = actions.get(next++);
        Team team = Team.valueOf(a.team());
        b.engine.queueAction(b.player(team), PlayerActionDTO.play(a.handIndex(), a.x(), a.y()));
      }
      b.engine.tick();
    }
    GameState gs = b.engine.getGameState();
    Team winner = b.match.getWinner() != null ? b.match.getWinner() : gs.getWinner();
    return new Outcome(
        winner == null ? null : winner.name(),
        winner == null,
        gs.getCrownCount(Team.BLUE),
        gs.getCrownCount(Team.RED),
        towerHp(gs, Team.BLUE),
        towerHp(gs, Team.RED),
        gs.getFrameCount());
  }

  private static int towerHp(GameState gs, Team team) {
    int total = 0;
    for (Tower t : gs.getTowers().get(team)) {
      if (t.isAlive()) {
        total += t.getHealth().getCurrent();
      }
    }
    return total;
  }

  /** True if the replay's recorded result is reproduced by re-simulation. */
  public static boolean matches(Replay replay, Outcome o) {
    Replay.Result r = replay.result();
    return r != null
        && r.blueCrowns() == o.blueCrowns()
        && r.redCrowns() == o.redCrowns()
        && r.blueTowerHp() == o.blueTowerHp()
        && r.redTowerHp() == o.redTowerHp()
        && r.frames() == o.frames()
        && r.draw() == o.draw()
        && (r.draw() || r.winner().equals(o.winner()));
  }
}
