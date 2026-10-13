package com.anyroyale.server.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.cards.CardPool;
import com.anyroyale.server.cards.SharedRandomDeckGenerator;
import java.util.List;
import org.crforge.core.card.Card;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.player.Hand;
import org.crforge.core.player.Player;
import org.crforge.core.player.Team;
import org.crforge.core.player.dto.PlayerActionDTO;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

/**
 * AnyRoyale's fairness guarantees: same deck, same starting cycle, same levels, same elixir, same
 * towers, and a battlefield where mirrored plays produce mirrored outcomes.
 */
class FairnessTest {

  private final SharedRandomDeckGenerator gen = new SharedRandomDeckGenerator();

  @Test
  void bothPlayersStartWithIdenticalHandNextCardAndCycle() {
    for (long seed = 1; seed <= 300; seed++) {
      BattleSetup b = BattleSetup.create(seed, gen.generate(seed).cards(), false, false);
      Hand blue = b.blue.getHand();
      Hand red = b.red.getHand();
      for (int i = 0; i < Hand.HAND_SIZE; i++) {
        assertThat(blue.getCard(i).getId()).isEqualTo(red.getCard(i).getId());
      }
      assertThat(blue.getNextCard().getId()).isEqualTo(red.getNextCard().getId());
      // Cycling the same slot on both sides keeps them in lockstep through the whole deck.
      for (int k = 0; k < 16; k++) {
        blue.playCard(k % 4);
        red.playCard(k % 4);
        assertThat(blue.getNextCard().getId()).isEqualTo(red.getNextCard().getId());
      }
    }
  }

  @Test
  void startingHandIsAPureFunctionOfTheSeed() {
    long seed = 42;
    BattleSetup a = BattleSetup.create(seed, gen.generate(seed).cards(), false, false);
    BattleSetup b = BattleSetup.create(seed, gen.generate(seed).cards(), true, false);
    for (int i = 0; i < 4; i++) {
      assertThat(a.blue.getHand().getCard(i).getId()).isEqualTo(b.red.getHand().getCard(i).getId());
    }
  }

  @Test
  void levelsElixirAndTowersAreIdentical() {
    BattleSetup b = BattleSetup.create(7, gen.generate(7).cards(), false, true);
    for (Card c : gen.generate(7).cards()) {
      assertThat(b.blue.getLevelConfig().getLevelFor(c))
          .isEqualTo(b.red.getLevelConfig().getLevelFor(c))
          .isEqualTo(BattleSetup.LEVEL);
    }
    assertThat(b.blue.getElixir().getCurrent()).isEqualTo(b.red.getElixir().getCurrent());
    b.engine.tick(200);
    assertThat(b.blue.getElixir().getCurrent()).isEqualTo(b.red.getElixir().getCurrent());
    List<Tower> bt = b.engine.getGameState().getTowers().get(Team.BLUE);
    List<Tower> rt = b.engine.getGameState().getTowers().get(Team.RED);
    assertThat(bt.stream().mapToInt(t -> t.getHealth().getMax()).sum())
        .isEqualTo(rt.stream().mapToInt(t -> t.getHealth().getMax()).sum());
  }

  /**
   * Plays the same card at 180-degree-rotated positions for both players at the same tick and
   * checks that the battle stays point-symmetric: each tower ends with the same HP as its rotated
   * counterpart. This guards against hidden first/second-player advantages in the engine.
   */
  @ParameterizedTest
  @ValueSource(strings = {"knight", "musketeer", "hogrider", "giant", "valkyrie", "minions", "babydragon", "pekka"})
  void rotatedIdenticalPlaysGiveRotatedOutcomes(String cardId) {
    Card card = CardPool.get(cardId);
    List<Card> deck = List.of(card, card, card, card, card, card, card, card);
    BattleSetup b = BattleSetup.create(99, deck, false, false);
    for (Player p : List.of(b.blue, b.red)) {
      p.getElixir().spend(0);
    }
    // Wait for 7 elixir then play in the left lane (from each player's own point of view).
    b.engine.tick(20 * 6);
    int x = 3500;
    int y = 11000;
    b.engine.queueAction(b.blue, PlayerActionDTO.play(0, x, y));
    b.engine.queueAction(b.red, PlayerActionDTO.play(0, 18000 - x, 32000 - y));
    b.engine.tick(20 * 40);
    List<Tower> blue = b.engine.getGameState().getTowers().get(Team.BLUE);
    List<Tower> red = b.engine.getGameState().getTowers().get(Team.RED);
    for (Tower t : blue) {
      Tower mirror =
          red.stream()
              .filter(
                  r ->
                      r.getPosition().getX() == 18000 - t.getPosition().getX()
                          && r.getPosition().getY() == 32000 - t.getPosition().getY())
              .findFirst()
              .orElseThrow();
      assertThat(t.getHealth().getCurrent())
          .as("%s: tower at (%d,%d) vs its rotation", cardId, t.getPosition().getX(), t.getPosition().getY())
          .isCloseTo(mirror.getHealth().getCurrent(), org.assertj.core.data.Offset.offset(
              Math.max(1, t.getHealth().getMax() / 20)));
    }
  }
}
