package com.anyroyale.server.cards;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.match.BattleSetup;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.crforge.core.card.Card;
import org.crforge.core.card.CardType;
import org.crforge.core.engine.GameState;
import org.crforge.core.entity.base.Entity;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.player.Team;
import org.crforge.core.player.dto.PlayerActionDTO;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Deploys every pool card in a real engine through the same validation path the server uses and
 * checks it has an observable effect. A card that cannot be deployed, throws, or does nothing
 * would fail here and must be removed from {@link CardPool}.
 */
class CardPoolSmokeTest {

  static Stream<String> poolCards() {
    return CardPool.all().stream().map(Card::getId);
  }

  @ParameterizedTest
  @MethodSource("poolCards")
  void cardDeploysAndActs(String id) {
    Card card = CardPool.get(id);
    // A deck of the card under test plus filler; Mirror needs a previous card.
    List<Card> deck = new ArrayList<>(List.of(card));
    for (String filler : List.of("knight", "archer", "fireball", "giant", "zap", "minions", "musketeer", "valkyrie")) {
      if (deck.size() < 8 && !filler.equals(id)) {
        deck.add(CardPool.get(filler));
      }
    }
    BattleSetup b = BattleSetup.create(1, deck, false, false);
    b.engine.tick(20 * 14); // reach 10 elixir
    GameState gs = b.engine.getGameState();
    int redTowerHpBefore = towerHp(gs, Team.RED);

    if (card.isMirror()) {
      int knight = slotOf(b, "knight", "archer", "giant", "musketeer", "valkyrie", "minions");
      assertThat(knight).isGreaterThanOrEqualTo(0);
      queue(b, knight, CardPool.get(b.blue.getHand().getCard(knight).getId()));
      b.engine.tick(5);
      b.engine.tick(20 * 6); // regain elixir for the mirrored copy
    }
    int slot = slotOf(b, id);
    assertThat(slot).as("card %s should be in hand", id).isGreaterThanOrEqualTo(0);
    int entitiesBefore = gs.getAliveEntities().size();
    float elixirBefore = b.blue.getElixir().getCurrent();
    queue(b, slot, card);
    b.engine.tick(3);
    assertThat(b.blue.getElixir().getCurrent())
        .as("%s must be accepted (elixir spent)", id)
        .isLessThan(elixirBefore);

    boolean sawEffect = false;
    for (int i = 0; i < 20 * 20 && b.engine.isRunning(); i++) {
      b.engine.tick();
      long blueThings =
          gs.getAliveEntities().stream()
              .filter(e -> e.getTeam() == Team.BLUE && !(e instanceof Tower))
              .count();
      if (blueThings > 0
          || !gs.getProjectiles().isEmpty()
          || gs.getAliveEntities().size() != entitiesBefore
          || towerHp(gs, Team.RED) < redTowerHpBefore) {
        sawEffect = true;
        break;
      }
    }
    assertThat(sawEffect).as("%s should spawn something or affect the arena", id).isTrue();
    // Let the card play out fully without exceptions.
    b.engine.tick(20 * 25);
  }

  private static void queue(BattleSetup b, int slot, Card card) {
    Card placedAs = card.isMirror() ? b.blue.getLastPlayedCard() : card;
    int[] pos = placement(placedAs);
    PlayerActionDTO action = PlayerActionDTO.play(slot, pos[0], pos[1]);
    assertThat(b.match.validateAction(b.blue, action))
        .as("placement for %s at (%d,%d)", card.getId(), pos[0], pos[1])
        .isTrue();
    b.engine.queueAction(b.blue, action);
  }

  private static int[] placement(Card card) {
    if (card.getType() == CardType.SPELL && !card.isSpellAsDeploy()) {
      return new int[] {3500, 23500}; // in front of the enemy left princess tower
    }
    if (card.isCanDeployOnEnemySide()) {
      return new int[] {3500, 22000};
    }
    if (card.getType() == CardType.BUILDING) {
      return new int[] {9000, 9500};
    }
    return new int[] {3500, 12500};
  }

  private static int slotOf(BattleSetup b, String... ids) {
    for (String id : ids) {
      for (int i = 0; i < 4; i++) {
        Card c = b.blue.getHand().getCard(i);
        if (c != null && c.getId().equals(id)) {
          return i;
        }
      }
    }
    // Cycle the hand until the card shows up (play cheap cards at the back).
    for (int attempt = 0; attempt < 8; attempt++) {
      for (int i = 0; i < 4; i++) {
        Card c = b.blue.getHand().getCard(i);
        boolean wanted = false;
        for (String id : ids) {
          wanted |= c.getId().equals(id);
        }
        if (wanted) {
          return i;
        }
      }
      b.blue.getHand().playCard(0);
    }
    return -1;
  }

  private static int towerHp(GameState gs, Team team) {
    int total = 0;
    for (Entity e : gs.getTowers().get(team)) {
      total += Math.max(0, e.getHealth().getCurrent());
    }
    return total;
  }
}
