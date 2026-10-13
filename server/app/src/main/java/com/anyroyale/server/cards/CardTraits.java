package com.anyroyale.server.cards;

import java.util.Set;
import org.crforge.core.card.AreaEffectStats;
import org.crforge.core.card.Card;
import org.crforge.core.card.CardType;
import org.crforge.core.card.ProjectileStats;
import org.crforge.core.card.TroopStats;
import org.crforge.core.entity.base.MovementType;
import org.crforge.core.entity.base.TargetType;

/**
 * Gameplay roles derived from engine card data. Used by the shared deck generator (to reject
 * unplayable decks) and by bots (to choose counters). Everything is computed from the same stats the
 * engine simulates, except the short explicit win-condition list below for cards whose role is not
 * visible in stats (spells and siege buildings).
 */
public record CardTraits(
    String id,
    CardType type,
    int cost,
    boolean spell,
    boolean building,
    boolean hitsAir,
    boolean hitsGround,
    boolean splash,
    boolean winCondition,
    boolean flying,
    boolean damagingSpell,
    boolean targetsBuildingsOnly,
    int spellRadius,
    int baseHealth,
    int unitCount) {

  private static final Set<String> EXTRA_WIN_CONDITIONS =
      Set.of(
          "goblinbarrel",
          "graveyard",
          "xbow",
          "mortar",
          "goblindrill",
          "miner",
          "rocket",
          "skeletonballoon",
          "wallbreakers",
          "elixirgolem",
          "goblingiant");

  public static CardTraits of(Card card) {
    boolean spell = card.getType() == CardType.SPELL;
    boolean building = card.getType() == CardType.BUILDING;
    TroopStats unit = card.getUnitStats();

    boolean hitsAir = false;
    boolean hitsGround = false;
    boolean splash = false;
    boolean onlyBuildings = false;
    boolean flying = false;
    int health = 0;
    if (unit != null) {
      TargetType tt = unit.getTargetType();
      onlyBuildings = tt == TargetType.BUILDINGS || unit.isTargetOnlyBuildings();
      boolean deals = unit.getDamage() > 0 || unit.getProjectile() != null;
      hitsAir = deals && !onlyBuildings && (tt == TargetType.ALL || tt == TargetType.AIR);
      hitsGround = deals && (tt == TargetType.ALL || tt == TargetType.GROUND || onlyBuildings);
      ProjectileStats p = unit.getProjectile();
      splash = unit.getAoeRadius() > 0 || (p != null && p.getRadius() > 0);
      flying = unit.getMovementType() == MovementType.AIR;
      health = unit.getHealth();
    }

    int radius = card.getSpellRadius();
    int spellDamage = 0;
    boolean spellHitsAir = false;
    ProjectileStats proj = card.getProjectile();
    if (proj != null) {
      spellDamage = Math.max(spellDamage, proj.getDamage());
      radius = Math.max(radius, proj.getRadius());
      spellHitsAir = true;
    }
    AreaEffectStats area = card.getAreaEffect();
    if (area != null) {
      spellDamage = Math.max(spellDamage, area.getDamage());
      radius = Math.max(radius, area.getRadius());
      spellHitsAir = spellHitsAir || area.isHitsAir();
    }
    boolean damagingSpell = spell && spellDamage > 0;
    if (damagingSpell) {
      splash = radius > 0;
      hitsAir = spellHitsAir;
      hitsGround = true;
    }

    boolean winCondition =
        onlyBuildings
            || card.isCanDeployOnEnemySide()
            || EXTRA_WIN_CONDITIONS.contains(card.getId());

    return new CardTraits(
        card.getId(),
        card.getType(),
        card.getCost(),
        spell,
        building,
        hitsAir,
        hitsGround,
        splash,
        winCondition,
        flying,
        damagingSpell,
        onlyBuildings,
        radius,
        health,
        Math.max(1, card.getTotalDeployCount()));
  }

  /** True for troops/buildings that can shoot air units (spells excluded). */
  public boolean antiAirUnit() {
    return hitsAir && !spell;
  }
}
