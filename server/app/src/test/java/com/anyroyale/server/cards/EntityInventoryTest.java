package com.anyroyale.server.cards;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.match.BattleSetup;
import com.anyroyale.server.util.Json;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.crforge.core.card.Card;
import org.crforge.core.card.CardType;
import org.crforge.core.entity.base.Entity;
import org.crforge.core.entity.effect.AreaEffect;
import org.crforge.core.entity.projectile.Projectile;
import org.crforge.core.entity.structure.Building;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.player.Team;
import org.crforge.core.player.dto.PlayerActionDTO;
import org.junit.jupiter.api.Test;

/**
 * Plays every pool card and records every entity and projectile-source name the engine produces
 * (main units, death spawns, live spawns, summons, area effects). Writes
 * build/entity-inventory.json; the web client's visual catalog is checked against it by
 * tools/compatibility/check-visual-coverage.mjs so no engine entity is ever drawn as "unknown".
 */
class EntityInventoryTest {

  @Test
  void collectEntityNames() throws Exception {
    Map<String, ObjectNode> names = new TreeMap<>();
    for (Card card : CardPool.all()) {
      List<Card> deck = new ArrayList<>();
      for (int i = 0; i < 8; i++) {
        deck.add(card);
      }
      BattleSetup b = BattleSetup.create(5, deck, false, false);
      b.engine.tick(20 * 14);
      int[] pos = pos(card);
      if (card.isMirror()) {
        continue;
      }
      b.engine.queueAction(b.blue, PlayerActionDTO.play(0, pos[0], pos[1]));
      for (int t = 0; t < 20 * 45 && b.engine.isRunning(); t++) {
        b.engine.tick();
        if (t % 4 != 0) {
          continue;
        }
        for (Entity e : b.engine.getGameState().getAliveEntities()) {
          if (e instanceof Tower || e.getTeam() != Team.BLUE) {
            continue;
          }
          String kind = e instanceof AreaEffect ? "A" : e instanceof Building ? "B" : "T";
          names.computeIfAbsent(
              e.getName(),
              n -> {
                ObjectNode o = Json.obj();
                o.put("kind", kind);
                o.put("movement", e.getMovementType().name());
                o.put("radius", e.getCollisionRadius());
                o.put("maxHp", e.getHealth().getMax());
                o.putArray("cards");
                return o;
              });
          var arr = (com.fasterxml.jackson.databind.node.ArrayNode) names.get(e.getName()).get("cards");
          boolean has = false;
          for (var x : arr) {
            has |= x.asText().equals(card.getId());
          }
          if (!has) {
            arr.add(card.getId());
          }
        }
        for (Projectile p : b.engine.getGameState().getProjectiles()) {
          Entity src = p.getSource();
          if (src != null && src.getTeam() == Team.BLUE && !(src instanceof Tower)) {
            names.get(src.getName()).put("shoots", true);
          }
        }
      }
    }
    ObjectNode root = Json.obj();
    names.forEach(root::set);
    Path out = Path.of("build", "entity-inventory.json");
    Files.createDirectories(out.getParent());
    Files.writeString(out, Json.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root));
    assertThat(names).isNotEmpty();
  }

  private static int[] pos(Card card) {
    if (card.getType() == CardType.SPELL && !card.isSpellAsDeploy()) {
      return new int[] {9000, 9000};
    }
    if (card.isCanDeployOnEnemySide() && card.getType() != CardType.SPELL) {
      return new int[] {3500, 22000};
    }
    if (card.getType() == CardType.BUILDING) {
      return new int[] {9000, 9500};
    }
    return new int[] {3500, 12500};
  }
}
