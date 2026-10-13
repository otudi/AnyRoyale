package com.anyroyale.server.cards;

import com.anyroyale.server.match.BattleSetup;
import com.anyroyale.server.util.Json;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.crforge.core.card.AreaEffectStats;
import org.crforge.core.card.Card;
import org.crforge.core.card.LevelScaling;
import org.crforge.core.card.ProjectileStats;
import org.crforge.core.card.TroopStats;

/**
 * Builds the /api/cards document from the live engine data, so the client's card names, costs and
 * stat panels always describe exactly what the server simulates (stats shown at match level).
 */
public final class CardCatalog {

  private CardCatalog() {}

  public static String json() {
    ObjectNode root = Json.obj();
    root.put("level", BattleSetup.LEVEL);
    root.put("count", CardPool.size());
    ArrayNode cards = root.putArray("cards");
    for (Card c : CardPool.all()) {
      cards.add(card(c));
    }
    return root.toString();
  }

  private static ObjectNode card(Card c) {
    int lvl = BattleSetup.LEVEL;
    CardTraits t = CardTraits.of(c);
    ObjectNode n = Json.obj();
    n.put("id", c.getId());
    n.put("name", c.getName());
    n.put("type", c.getType().name());
    n.put("rarity", c.getRarity().name());
    n.put("cost", c.getCost());
    n.put("count", Math.max(1, c.getTotalDeployCount()));
    n.put("spellAsDeploy", c.isSpellAsDeploy());
    n.put("canDeployOnEnemySide", c.isCanDeployOnEnemySide());
    n.put("mirror", c.isMirror());
    ArrayNode tags = n.putArray("tags");
    if (t.hitsAir()) tags.add("air");
    if (t.hitsGround()) tags.add("ground");
    if (t.splash()) tags.add("splash");
    if (t.winCondition()) tags.add("wincon");
    if (t.flying()) tags.add("flying");
    if (t.targetsBuildingsOnly()) tags.add("buildings");
    TroopStats u = c.getUnitStats();
    if (u != null) {
      ObjectNode unit = n.putObject("unit");
      unit.put("name", u.getName());
      unit.put("hp", LevelScaling.scaleCard(u.getHealth(), lvl));
      int dmg = u.getDamage();
      if (dmg == 0 && u.getProjectile() != null) {
        dmg = u.getProjectile().getDamage();
      }
      unit.put("damage", LevelScaling.scaleCard(dmg, lvl));
      unit.put("hitSpeed", u.getAttackCooldown());
      unit.put("speed", u.getSpeed());
      unit.put("range", u.getRange());
      unit.put("radius", u.getCollisionRadius());
      unit.put("target", u.getTargetType().name());
      unit.put("movement", u.getMovementType().name());
      unit.put("deployTime", u.getDeployTime());
      if (u.getLifeTime() > 0) {
        unit.put("lifetime", u.getLifeTime());
      }
    }
    int radius = t.spellRadius();
    ProjectileStats p = c.getProjectile();
    AreaEffectStats a = c.getAreaEffect();
    if (p != null || a != null || radius > 0) {
      ObjectNode spell = n.putObject("spell");
      spell.put("radius", radius);
      int dmg = 0;
      if (p != null) {
        dmg = Math.max(dmg, p.getDamage());
      }
      if (a != null) {
        dmg = Math.max(dmg, a.getDamage());
        spell.put("duration", a.getLifeDuration());
      }
      spell.put("damage", LevelScaling.scaleCard(dmg, lvl));
    }
    return n;
  }
}
