package com.anyroyale.server.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.cards.CardPool;
import java.util.ArrayList;
import java.util.List;
import org.crforge.core.card.Card;
import org.crforge.core.player.dto.PlayerActionDTO;
import org.junit.jupiter.api.Test;

/** Regression for the vendored Match.validateAction fix (see server/engine/VENDOR.md). */
class SpellPlacementRegressionTest {

  private BattleSetup withInHand(String id) {
    List<Card> deck = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      deck.add(CardPool.get(id));
    }
    return BattleSetup.create(3, deck, false, false);
  }

  @Test
  void tornadoCanBeCastOnTheEnemySide() {
    BattleSetup b = withInHand("tornado");
    assertThat(b.match.validateAction(b.blue, PlayerActionDTO.play(0, 4000, 22000))).isTrue();
  }

  @Test
  void logAndHealStayOnTheOwnSide() {
    for (String id : List.of("log", "heal", "royaldelivery", "barblog")) {
      BattleSetup b = withInHand(id);
      assertThat(b.match.validateAction(b.blue, PlayerActionDTO.play(0, 4000, 22000)))
          .as(id + " on enemy side")
          .isFalse();
      assertThat(b.match.validateAction(b.blue, PlayerActionDTO.play(0, 4000, 10000)))
          .as(id + " on own side")
          .isTrue();
    }
  }
}
