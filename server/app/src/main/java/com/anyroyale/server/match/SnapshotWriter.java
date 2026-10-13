package com.anyroyale.server.match;

import com.anyroyale.server.util.Json;
import com.fasterxml.jackson.core.JsonGenerator;
import java.io.IOException;
import java.io.StringWriter;
import java.io.UncheckedIOException;
import java.util.List;
import org.crforge.core.card.Card;
import org.crforge.core.component.Combat;
import org.crforge.core.effect.AppliedEffect;
import org.crforge.core.engine.GameState;
import org.crforge.core.entity.base.Entity;
import org.crforge.core.entity.base.MovementType;
import org.crforge.core.entity.effect.AreaEffect;
import org.crforge.core.entity.projectile.Projectile;
import org.crforge.core.entity.structure.Building;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.entity.unit.Troop;
import org.crforge.core.player.Hand;
import org.crforge.core.player.Player;
import org.crforge.core.player.Team;

/**
 * Serialises authoritative match state into the compact "snap" message (see
 * shared/protocols/PROTOCOL.md). Each player gets their own snapshot: their hand and elixir are
 * included, the opponent's hand and elixir are not (hidden information in Clash Royale).
 *
 * <p>Snapshots are full state, not deltas: every snapshot re-synchronises a client completely, so a
 * dropped or late message never leaves a client permanently out of sync.
 */
public final class SnapshotWriter {

  // Entity flag bits (keep in sync with apps/web/src/network/protocol.ts)
  public static final int F_DEPLOYING = 1;
  public static final int F_ATTACKING = 2;
  public static final int F_STUNNED = 4;
  public static final int F_FROZEN = 8;
  public static final int F_SLOWED = 16;
  public static final int F_RAGED = 32;
  public static final int F_INVISIBLE = 64;
  public static final int F_JUMPING = 128;
  public static final int F_TUNNELING = 256;
  public static final int F_POISONED = 512;
  public static final int F_INACTIVE_TOWER = 1024;
  public static final int F_ATTACHED = 2048;
  public static final int F_HIDDEN_BUILDING = 4096;
  public static final int F_CURSED = 8192;

  private SnapshotWriter() {}

  /**
   * Writes one snapshot.
   *
   * @param viewer the player this snapshot is for, or null for a spectator/replay view
   */
  public static String write(
      MatchSession.Clock clock,
      GameState state,
      List<Projectile> projectiles,
      Player viewer,
      int opponentCrowns,
      int ownCrowns,
      List<Object[]> events,
      SpellAttribution spells) {
    StringWriter out = new StringWriter(4096);
    try (JsonGenerator g = Json.MAPPER.getFactory().createGenerator(out)) {
      g.writeStartObject();
      g.writeStringField("type", "snap");
      g.writeNumberField("tick", clock.tick());
      g.writeNumberField("timeLeft", round1(clock.timeLeftSeconds()));
      g.writeStringField("phase", clock.phase());
      g.writeNumberField("elixirRate", clock.elixirMultiplier());

      if (viewer != null) {
        g.writeObjectFieldStart("me");
        g.writeNumberField("elixir", round2(viewer.getElixir().getCurrent()));
        g.writeArrayFieldStart("hand");
        Hand hand = viewer.getHand();
        for (int i = 0; i < Hand.HAND_SIZE; i++) {
          Card c = hand.getCard(i);
          g.writeString(c == null ? null : c.getId());
        }
        g.writeEndArray();
        Card next = hand.getNextCard();
        g.writeStringField("next", next == null ? null : next.getId());
        g.writeNumberField("crowns", ownCrowns);
        g.writeEndObject();
        g.writeObjectFieldStart("opp");
        g.writeNumberField("crowns", opponentCrowns);
        g.writeEndObject();
      }

      g.writeArrayFieldStart("e");
      for (Entity e : state.getAliveEntities()) {
        writeEntity(g, e);
      }
      g.writeEndArray();

      g.writeArrayFieldStart("p");
      for (Projectile p : projectiles) {
        if (!p.isActive()) {
          continue;
        }
        writeProjectile(g, p, spells);
      }
      g.writeEndArray();

      g.writeArrayFieldStart("ev");
      for (Object[] ev : events) {
        g.writeStartArray();
        for (Object o : ev) {
          g.writeObject(o);
        }
        g.writeEndArray();
      }
      g.writeEndArray();

      g.writeEndObject();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return out.toString();
  }

  /** [id, name, team, kind, move, x, y, hp, maxHp, shield, flags, targetId, radius, extra] */
  private static void writeEntity(JsonGenerator g, Entity e) throws IOException {
    g.writeStartArray();
    g.writeNumber(e.getId());
    g.writeString(e.getName());
    g.writeNumber(e.getTeam() == Team.BLUE ? 0 : 1);
    String kind;
    double extra = 0;
    if (e instanceof Tower) {
      kind = ((Tower) e).isCrownTower() ? "K" : "P";
    } else if (e instanceof AreaEffect a) {
      kind = "A";
      float life = a.getStats() != null ? a.getStats().getLifeDuration() : 0;
      extra = life > 0 ? round2(Math.max(0, a.getRemainingLifetime()) / life) : 0;
    } else if (e instanceof Building b) {
      kind = "B";
      extra = b.hasLifetime() ? round2(b.getRemainingLifetime() / b.getLifetime()) : 1;
    } else {
      kind = "T";
    }
    g.writeString(kind);
    MovementType mt = e.getMovementType();
    g.writeNumber(mt == MovementType.AIR ? 1 : mt == MovementType.BUILDING ? 2 : 0);
    g.writeNumber(e.getPosition().getX());
    g.writeNumber(e.getPosition().getY());
    g.writeNumber(Math.max(0, e.getHealth().getCurrent()));
    g.writeNumber(e.getHealth().getMax());
    g.writeNumber(e.getHealth().getShield());
    g.writeNumber(flags(e));
    Combat c = e.getCombat();
    Entity target = c != null ? c.getCurrentTarget() : null;
    g.writeNumber(target != null ? target.getId() : 0);
    int radius =
        e instanceof AreaEffect a && a.getStats() != null
            ? a.getStats().getRadius()
            : e.getCollisionRadius();
    g.writeNumber(radius);
    g.writeNumber(extra);
    g.writeEndArray();
  }

  static int flags(Entity e) {
    int f = 0;
    if (e instanceof Troop t) {
      if (t.isDeploying()) f |= F_DEPLOYING;
      if (t.isInvisible()) f |= F_INVISIBLE;
      if (t.isJumping()) f |= F_JUMPING;
      if (t.isTunneling()) f |= F_TUNNELING;
      if (t.isAttached()) f |= F_ATTACHED;
    } else if (e instanceof Tower tw) {
      if (!tw.isActive()) f |= F_INACTIVE_TOWER;
    } else if (e instanceof Building b) {
      if (b.isDeploying()) f |= F_DEPLOYING;
      if (b.isHidden()) f |= F_HIDDEN_BUILDING;
    }
    Combat c = e.getCombat();
    if (c != null && c.isAttacking()) {
      f |= F_ATTACKING;
    }
    for (AppliedEffect eff : e.getAppliedEffects()) {
      switch (eff.getType()) {
        case STUN -> f |= F_STUNNED;
        case FREEZE -> f |= F_FROZEN;
        case SLOW -> f |= F_SLOWED;
        case RAGE -> f |= F_RAGED;
        case POISON -> f |= F_POISONED;
        case CURSE -> f |= F_CURSED;
        default -> {}
      }
    }
    return f;
  }

  /** [id, team, x, y, targetX, targetY, sourceId, aoeRadius, visualKey] */
  private static void writeProjectile(JsonGenerator g, Projectile p, SpellAttribution spells)
      throws IOException {
    g.writeStartArray();
    g.writeNumber(p.getId());
    g.writeNumber(p.getTeam() == Team.BLUE ? 0 : 1);
    g.writeNumber(p.getPosition().getX());
    g.writeNumber(p.getPosition().getY());
    int tx;
    int ty;
    if (p.isPositionTargeted()) {
      tx = p.getTargetX();
      ty = p.getTargetY();
    } else if (p.getTarget() != null) {
      tx = p.getTarget().getPosition().getX();
      ty = p.getTarget().getPosition().getY();
    } else {
      tx = p.getPosition().getX();
      ty = p.getPosition().getY();
    }
    g.writeNumber(tx);
    g.writeNumber(ty);
    Entity src = p.getSource() != null ? p.getSource() : p.getSourceEntity();
    g.writeNumber(src != null ? src.getId() : 0);
    g.writeNumber(p.getAoeRadius());
    String key;
    if (src != null) {
      key = src.getName();
    } else {
      key = spells.cardFor(p);
    }
    g.writeString(key);
    g.writeEndArray();
  }

  private static double round1(double v) {
    return Math.round(v * 10.0) / 10.0;
  }

  private static double round2(double v) {
    return Math.round(v * 100.0) / 100.0;
  }
}
