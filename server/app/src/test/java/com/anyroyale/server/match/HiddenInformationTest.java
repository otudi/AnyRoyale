package com.anyroyale.server.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.cards.CardPool;
import com.anyroyale.server.util.Json;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.crforge.core.card.Card;
import org.crforge.core.entity.unit.Troop;
import org.crforge.core.player.Team;
import org.crforge.core.player.dto.PlayerActionDTO;
import org.junit.jupiter.api.Test;

/** Invisible enemy troops must never reach the opponent's snapshot. */
class HiddenInformationTest {

  @Test
  void invisibleEnemyTroopsAreOmittedForTheOpponentOnly() {
    List<Card> deck = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      deck.add(CardPool.get("suspiciousbush"));
    }
    BattleSetup b = BattleSetup.create(11, deck, false, false);
    b.engine.tick(20 * 3);
    b.engine.queueAction(b.blue, PlayerActionDTO.play(0, 3500, 10000));
    b.engine.tick(20 * 4);
    Troop bush =
        b.engine.getGameState().getAliveEntities().stream()
            .filter(e -> e instanceof Troop t && t.isInvisible())
            .map(e -> (Troop) e)
            .findFirst()
            .orElseThrow();
    assertThat(bush.getTeam()).isEqualTo(Team.BLUE);
    MatchSession.Clock clock = new MatchSession.Clock(1, 100, "regular", 1);
    String forRed =
        SnapshotWriter.write(clock, b.engine.getGameState(), List.of(), b.red, 0, 0, List.of(), new SpellAttribution());
    String forBlue =
        SnapshotWriter.write(clock, b.engine.getGameState(), List.of(), b.blue, 0, 0, List.of(), new SpellAttribution());
    assertThat(ids(forRed)).doesNotContain(bush.getId());
    assertThat(ids(forBlue)).contains(bush.getId());
  }

  private static List<Long> ids(String snap) {
    List<Long> ids = new ArrayList<>();
    for (JsonNode e : Json.parseObject(snap).get("e")) {
      ids.add(e.get(0).asLong());
    }
    return ids;
  }
}
