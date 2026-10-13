package com.anyroyale.server.bots;

import com.anyroyale.server.cards.CardPool;
import com.anyroyale.server.cards.CardTraits;
import com.anyroyale.server.match.BattleSetup;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.crforge.core.card.AreaEffectStats;
import org.crforge.core.card.Card;
import org.crforge.core.card.CardType;
import org.crforge.core.card.LevelScaling;
import org.crforge.core.card.ProjectileStats;
import org.crforge.core.card.TroopStats;
import org.crforge.core.entity.base.Entity;
import org.crforge.core.entity.base.EntityType;
import org.crforge.core.entity.base.MovementType;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.entity.unit.Troop;
import org.crforge.core.player.Team;

/**
 * Rule-based Clash Royale bot.
 *
 * <p>Each think it (1) lists visible enemy threats per lane, (2) decides whether its towers and
 * troops already handle them, (3) evaluates damaging spells against enemy clusters, and (4) if not
 * defending, builds pushes with win conditions and supports surviving defenders. How well each step
 * is done depends on {@link BotProfile}: reaction time, counter selection, placement precision,
 * spell discipline, elixir management and (Expert only) elixir counting and cycle tracking from the
 * opponent's visible plays.
 *
 * <p>All reasoning happens in "local" coordinates where the bot's king tower is at the bottom
 * (small y), so the same logic serves both seats; positions are mirrored back before returning.
 */
final class HeuristicBot implements BotBrain {

  private static final int W = 18000;
  private static final int H = 32000;
  private static final int LEFT_LANE_X = 3500;
  private static final int RIGHT_LANE_X = 14500;

  private static final Set<String> FAST_BUILDING_TARGETERS =
      Set.of("hogrider", "battleram", "ramrider", "royalhogs", "wallbreakers", "skeletonballoon",
          "balloon", "elixirgolem", "goblindemolisher");
  private static final Set<String> TOWER_SPELLS =
      Set.of("goblinbarrel", "graveyard", "miner", "goblindrill");
  private static final Set<String> SIEGE = Set.of("xbow", "mortar");
  private static final Set<String> SMALL_SPELLS =
      Set.of("zap", "log", "arrows", "snowball", "barblog", "goblincurse");

  private final BotProfile p;
  private final Random rng;
  private int nextThinkTick;
  private final Map<Long, Integer> firstSeen = new HashMap<>();
  private Map<String, Double> unitValue;

  // Expert-only opponent model, built purely from public information.
  private double oppElixir = 5.0;
  private int lastTrackTick;
  private int seenPlayCount;
  private final Deque<String> oppRecent = new ArrayDeque<>();

  HeuristicBot(BotProfile profile, long seed) {
    this.p = profile;
    this.rng = new Random(seed);
  }

  @Override
  public String difficulty() {
    return p.name();
  }

  BotProfile profile() {
    return p;
  }

  // ---------------------------------------------------------------------------------------------

  private record Threat(Entity e, int x, int y, boolean air, boolean buildingTargeter, double value, int hp) {
    int lane() {
      return x < W / 2 ? 0 : 1;
    }
  }

  private record Candidate(int slot, Card card, int x, int y, double score, String why) {
    Candidate(int slot, Card card, int x, int y, double score) {
      this(slot, card, x, y, score, "");
    }

    Candidate why(String reason) {
      return new Candidate(slot, card, x, y, score, reason);
    }
  }

  /**
   * Elixir value committed per local lane with its expiry tick. A deployed card is invisible for
   * about a second (server sync delay) and then deploys, so without this memory a fast-thinking
   * bot would keep "seeing" an undefended lane and pay twice.
   */
  private final double[] committedValue = new double[2];
  private final int[] committedUntil = new int[2];

  /** Set by defend() when a lane needs more defence than towers and troops provide. */
  private boolean underPressure;

  /** Why the last decision was taken (debugging and test diagnostics only). */
  String lastReason = "";

  @Override
  public Decision think(BotView v) {
    if (v.tick() < nextThinkTick) {
      return null;
    }
    nextThinkTick = v.tick() + p.thinkIntervalTicks() + (p == BotProfile.EASY ? rng.nextInt(25) : 0);
    if (unitValue == null) {
      unitValue = buildUnitValues(v.deck());
    }
    trackOpponent(v);

    List<Threat> threats = threats(v);
    Candidate best = null;

    underPressure = false;
    if (!threats.isEmpty() && rng.nextDouble() >= p.ignoreThreatRate()) {
      best = better(best, tag(defend(v, threats), "defend"));
    }
    best = better(best, tag(bestSpell(v), "spell"));
    if (best == null || best.score() < 4) {
      best = better(best, tag(attack(v, !underPressure), "attack"));
    }
    if (best == null && p.avoidLeak() && v.elixir() >= 9.6) {
      best = tag(leakPlay(v), "leak");
    }
    if (best == null) {
      return null;
    }
    if (rng.nextDouble() < p.mistakeRate()) {
      Candidate random = randomPlay(v);
      if (random != null) {
        best = random.why("mistake");
      }
    }
    lastReason = best.why();
    Decision decision = finalise(v, best);
    if (decision != null && best.card().getType() != CardType.SPELL) {
      int lane = best.x() < W / 2 ? 0 : 1;
      if (v.tick() >= committedUntil[lane]) {
        committedValue[lane] = 0;
      }
      committedValue[lane] += best.card().getCost();
      committedUntil[lane] = v.tick() + 50;
    }
    return decision;
  }

  private static Candidate tag(Candidate c, String why) {
    return c == null ? null : c.why(why + (c.why().isEmpty() ? "" : ":" + c.why()));
  }

  // ---------------------------------------------------------------------------------------------
  // Threat assessment
  // ---------------------------------------------------------------------------------------------

  private List<Threat> threats(BotView v) {
    int horizon = p.buildingPull() ? 17500 : 15000;
    List<Threat> out = new ArrayList<>();
    Set<Long> alive = new HashSet<>();
    for (Entity e : v.visibleEntities()) {
      alive.add(e.getId());
      firstSeen.putIfAbsent(e.getId(), v.tick());
      if (e.getTeam() == v.team() || e.getEntityType() != EntityType.TROOP) {
        continue;
      }
      if (e instanceof Troop t && t.isAttached()) {
        continue;
      }
      if (v.tick() - firstSeen.get(e.getId()) < p.reactionTicks()) {
        continue;
      }
      int lx = lx(v, e.getPosition().getX());
      int ly = ly(v, e.getPosition().getY());
      if (ly > horizon) {
        continue;
      }
      boolean buildingTargeter =
          e.getCombat() != null && e.getCombat().isTargetOnlyBuildings()
              || e.getCombat() != null
                  && e.getCombat().getTargetType() == org.crforge.core.entity.base.TargetType.BUILDINGS;
      out.add(
          new Threat(
              e,
              lx,
              ly,
              e.getMovementType() == MovementType.AIR,
              buildingTargeter,
              valueOf(e),
              e.getHealth().getCurrent()));
    }
    firstSeen.keySet().retainAll(alive);
    return out;
  }

  private Candidate defend(BotView v, List<Threat> threats) {
    double[] laneValue = new double[2];
    boolean[] laneAir = new boolean[2];
    Threat[] lead = new Threat[2];
    int[] count = new int[2];
    for (Threat t : threats) {
      int lane = t.lane();
      laneValue[lane] += t.value();
      laneAir[lane] |= t.air();
      count[lane]++;
      if (lead[lane] == null || t.y() < lead[lane].y()) {
        lead[lane] = t;
      }
    }
    int lane = laneValue[0] >= laneValue[1] ? 0 : 1;
    Threat leader = lead[lane];
    if (leader == null) {
      return null;
    }
    double defence = ownDefenceNear(v, leader);
    if (v.tick() < committedUntil[lane]) {
      defence += committedValue[lane];
    }
    boolean towerAlive = princessAlive(v, v.team(), lane);
    double net = laneValue[lane] - 0.8 * defence - (towerAlive ? 1.5 : 0.5);
    if (net <= 0) {
      return null;
    }
    underPressure = true;
    boolean swarm = count[lane] >= 3;
    boolean tank = leader.hp() > 2500;
    if (p.defendUnderTower()
        && towerAlive
        && !leader.air()
        && !leader.buildingTargeter()
        && leader.y() > 12500) {
      // Wait until the attacker is inside princess-tower range so the tower shares the work.
      // Meanwhile only spend if elixir would otherwise be wasted at the cap.
      underPressure = v.elixir() < 8.5;
      return null;
    }

    List<Candidate> options = new ArrayList<>();
    for (int slot = 0; slot < 4; slot++) {
      Card c = v.handCard(slot);
      if (c == null || c.getType() == CardType.SPELL || c.isMirror() || !affordable(v, c)) {
        continue;
      }
      CardTraits tr = CardTraits.of(c);
      if (tr.targetsBuildingsOnly()) {
        continue; // win conditions such as Hog Rider cannot defend
      }
      if (laneAir[lane] && !tr.hitsAir()) {
        continue;
      }
      if (!tr.hitsGround() && !leader.air()) {
        continue;
      }
      double score;
      if (!p.counterSelection()) {
        score = 5 + rng.nextDouble() * 3;
      } else {
        score = 5;
        if (swarm && tr.splash()) {
          score += 3;
        }
        if (leader.buildingTargeter() && tr.building()) {
          score += 3;
        }
        if (tank) {
          score += dps(c) / 150.0;
          if (tr.unitCount() >= 3 && !leader.air()) {
            score += 1.5;
          }
        }
        if (swarm && tr.unitCount() == 1 && !tr.splash()) {
          score -= 1.5;
        }
        double overpay = c.getCost() - laneValue[lane];
        if (overpay > 0) {
          score -= overpay * 0.6;
        }
        score += net * 0.5;
      }
      int[] pos = defensivePosition(v, c, tr, leader, lane);
      options.add(new Candidate(slot, c, pos[0], pos[1], score + 2));
    }
    Candidate best = null;
    for (Candidate o : options) {
      best = better(best, o);
    }
    if (best != null && p.cheapCounters()) {
      // Any counter within one point of the best is adequate: pay as little as possible.
      for (Candidate o : options) {
        if (o.score() >= best.score() - 1.0 && o.card().getCost() < best.card().getCost()) {
          best = new Candidate(o.slot(), o.card(), o.x(), o.y(), best.score());
        }
      }
    }
    return best;
  }

  private int[] defensivePosition(BotView v, Card c, CardTraits tr, Threat leader, int lane) {
    int towerX = lane == 0 ? LEFT_LANE_X : RIGHT_LANE_X;
    if (tr.building()) {
      if (p.buildingPull() && leader.buildingTargeter()) {
        return new int[] {W / 2 + (lane == 0 ? -500 : 500), 8500};
      }
      return new int[] {(towerX + W / 2) / 2, 9000};
    }
    TroopStats u = c.getUnitStats();
    int range = u != null ? u.getRange() : 1000;
    int ty = leader.y();
    int tx = leader.x();
    if (range >= 3000) {
      // Ranged: stay behind the tower line, inside range of where the threat will be.
      int y = clamp(Math.min(ty - range + 1500, 8000), 1500, 13500);
      int x = (tx + towerX) / 2;
      return new int[] {x, y};
    }
    // Melee: meet the threat in front of the tower, where the tower can help.
    int y = clamp(Math.min(ty - 3000, 9500), 2000, 13500);
    return new int[] {tx, y};
  }

  private double ownDefenceNear(BotView v, Threat t) {
    double sum = 0;
    for (Entity e : v.visibleEntities()) {
      if (e.getTeam() != v.team() || e instanceof Tower) {
        continue;
      }
      if (e.getEntityType() != EntityType.TROOP && e.getEntityType() != EntityType.BUILDING) {
        continue;
      }
      int dx = lx(v, e.getPosition().getX()) - t.x();
      int dy = ly(v, e.getPosition().getY()) - t.y();
      if ((long) dx * dx + (long) dy * dy < 7000L * 7000L) {
        sum += valueOf(e);
      }
    }
    return sum;
  }

  // ---------------------------------------------------------------------------------------------
  // Spells
  // ---------------------------------------------------------------------------------------------

  private Candidate bestSpell(BotView v) {
    Candidate best = null;
    boolean lateGame = v.overtime() || v.timeLeftSeconds() < 30;
    for (int slot = 0; slot < 4; slot++) {
      Card c = v.handCard(slot);
      if (c == null || c.getType() != CardType.SPELL || !affordable(v, c)) {
        continue;
      }
      CardTraits tr = CardTraits.of(c);
      if (!tr.damagingSpell() || TOWER_SPELLS.contains(c.getId())) {
        continue;
      }
      int radius = Math.max(tr.spellRadius(), 1500);
      int damage = LevelScaling.scaleCard(spellDamage(c), BattleSetup.LEVEL);
      double bestValue = 0;
      int bx = 0;
      int by = 0;
      List<int[]> centres = new ArrayList<>();
      for (Entity e : v.visibleEntities()) {
        if (e.getTeam() != v.team() && (e.getEntityType() == EntityType.TROOP || e.getEntityType() == EntityType.BUILDING || e instanceof Tower)) {
          centres.add(new int[] {e.getPosition().getX(), e.getPosition().getY()});
        }
      }
      for (int[] ctr : centres) {
        double value = 0;
        for (Entity e : v.visibleEntities()) {
          if (e.getTeam() == v.team()) {
            continue;
          }
          long dx = e.getPosition().getX() - ctr[0];
          long dy = e.getPosition().getY() - ctr[1];
          long reach = radius + e.getCollisionRadius();
          if (dx * dx + dy * dy > reach * reach) {
            continue;
          }
          if (e instanceof Tower) {
            value += lateGame ? 2.0 : 0.6;
          } else if (e.getEntityType() == EntityType.TROOP || e.getEntityType() == EntityType.BUILDING) {
            if (e.getMovementType() == MovementType.AIR && !tr.hitsAir()) {
              continue;
            }
            double kill = Math.min(1.0, damage / (double) Math.max(1, e.getHealth().getCurrent()));
            value += valueOf(e) * (0.35 + 0.65 * kill);
          }
        }
        if (value > bestValue) {
          bestValue = value;
          bx = ctr[0];
          by = ctr[1];
        }
      }
      if (bestValue <= 0) {
        continue;
      }
      double needed = c.getCost() * p.spellValueRatio();
      if (bestValue < needed) {
        continue;
      }
      int x = lx(v, bx);
      int y = ly(v, by);
      if (c.isSpellAsDeploy()) {
        // Log-style spells roll forward from the player's side.
        y = clamp(y - 1500, 1000, 13900);
      }
      best = better(best, new Candidate(slot, c, x, y, 4 + (bestValue - needed) * 1.5));
    }
    return best;
  }

  private static int spellDamage(Card c) {
    int dmg = 0;
    ProjectileStats proj = c.getProjectile();
    if (proj != null) {
      dmg = Math.max(dmg, proj.getDamage());
    }
    AreaEffectStats area = c.getAreaEffect();
    if (area != null) {
      dmg = Math.max(dmg, area.getDamage());
    }
    return dmg;
  }

  // ---------------------------------------------------------------------------------------------
  // Offence
  // ---------------------------------------------------------------------------------------------

  private Candidate attack(BotView v, boolean calm) {
    double threshold = p.minAttackElixir();
    if (p == BotProfile.EASY) {
      threshold = 3 + rng.nextDouble() * 6;
    }
    if (p.trackOpponent() && oppElixir < 1.5 && v.elixir() >= 6) {
      threshold = Math.min(threshold, 6.0); // punish an opponent who is nearly out of elixir
    }
    if (v.elixirMultiplier() >= 2) {
      threshold -= 1.0;
    }
    int lane = chooseLane(v);
    // Counter-push: support own units already crossing.
    if (p.supportPushes()) {
      Candidate support = supportPush(v);
      if (support != null) {
        return support;
      }
    }
    if (v.elixir() < threshold || !calm && p != BotProfile.EASY) {
      return null;
    }
    if (p.defendUnderTower() && !calm) {
      return null;
    }
    Candidate best = null;
    for (int slot = 0; slot < 4; slot++) {
      Card c = v.handCard(slot);
      if (c == null || !affordable(v, c) || c.isMirror()) {
        continue;
      }
      CardTraits tr = CardTraits.of(c);
      int laneX = lane == 0 ? LEFT_LANE_X : RIGHT_LANE_X;
      double score;
      int x;
      int y;
      if (TOWER_SPELLS.contains(c.getId())) {
        score = 6;
        x = laneX;
        y = c.getId().equals("goblindrill") ? 23000 : 25500;
        if (c.getId().equals("graveyard")) {
          y = 24500;
        }
      } else if (SIEGE.contains(c.getId())) {
        score = 6;
        x = laneX + (lane == 0 ? 1000 : -1000);
        y = 12000;
      } else if (tr.winCondition() && tr.type() != CardType.SPELL) {
        score = 6.5;
        x = laneX;
        if (FAST_BUILDING_TARGETERS.contains(c.getId())) {
          y = 13500;
        } else if (c.getCost() >= 7 && v.elixir() >= 9) {
          x = lane == 0 ? 6500 : 11500; // heavy tank from the back
          y = 1500;
          score += 0.5;
        } else {
          y = 12500;
        }
      } else if (c.getType() == CardType.TROOP && !tr.targetsBuildingsOnly()) {
        score = 2.5 + (tr.splash() ? 0.5 : 0);
        x = laneX + (lane == 0 ? 1500 : -1500);
        y = 9000;
      } else {
        continue;
      }
      if (p.trackOpponent()) {
        score += cycleBonus(tr);
      }
      if (p == BotProfile.EASY) {
        score = rng.nextDouble() * 6;
      }
      best = better(best, new Candidate(slot, c, x, y, score));
    }
    return best;
  }

  private Candidate supportPush(BotView v) {
    double pushValue = 0;
    int px = 0;
    int py = 0;
    for (Entity e : v.visibleEntities()) {
      if (e.getTeam() != v.team() || e.getEntityType() != EntityType.TROOP) {
        continue;
      }
      int ly = ly(v, e.getPosition().getY());
      if (ly > 12500 && ly < 22000) {
        double val = valueOf(e) * e.getHealth().percentage();
        pushValue += val;
        if (ly > py) {
          py = ly;
          px = lx(v, e.getPosition().getX());
        }
      }
    }
    if (pushValue < 3 || v.elixir() < 4) {
      return null;
    }
    Candidate best = null;
    for (int slot = 0; slot < 4; slot++) {
      Card c = v.handCard(slot);
      if (c == null || !affordable(v, c) || c.getType() == CardType.SPELL || c.isMirror()) {
        continue;
      }
      CardTraits tr = CardTraits.of(c);
      if (tr.building()) {
        continue;
      }
      double score = 3 + (tr.winCondition() ? 2.5 : 0) + (tr.splash() ? 0.5 : 0) - c.getCost() * 0.2;
      int y = clamp(Math.min(py - 1500, 13500), 9000, 13500);
      best = better(best, new Candidate(slot, c, px, y, score));
    }
    return best;
  }

  /** Expert: prefer air/swarm pushes when the opponent's answers were just cycled away. */
  private double cycleBonus(CardTraits tr) {
    Set<String> possibleHand = new HashSet<>();
    // Cards played in the last 4 opponent plays are at the back of their cycle.
    List<String> recent = new ArrayList<>(oppRecent);
    for (String id : deckIds) {
      if (!recent.contains(id)) {
        possibleHand.add(id);
      }
    }
    boolean smallSpellReady = possibleHand.stream().anyMatch(SMALL_SPELLS::contains);
    boolean antiAirReady =
        possibleHand.stream()
            .map(CardPool::get)
            .filter(c -> c != null)
            .map(CardTraits::of)
            .anyMatch(CardTraits::antiAirUnit);
    double bonus = 0;
    if (tr.unitCount() >= 3 && !smallSpellReady) {
      bonus += 1.5;
    }
    if (tr.flying() && !antiAirReady) {
      bonus += 2;
    }
    return bonus;
  }

  private List<String> deckIds = List.of();

  private int chooseLane(BotView v) {
    Team enemy = v.team().opposite();
    double left = laneTowerHpRatio(v, enemy, 0);
    double right = laneTowerHpRatio(v, enemy, 1);
    if (p == BotProfile.EASY) {
      return rng.nextInt(2);
    }
    if (Math.abs(left - right) < 0.05) {
      return (v.tick() / 600) % 2; // alternate occasionally when even
    }
    return left < right ? 0 : 1;
  }

  private double laneTowerHpRatio(BotView v, Team team, int localLane) {
    for (Tower t : v.towers(team)) {
      if (!t.isPrincessTower()) {
        continue;
      }
      int lane = lx(v, t.getPosition().getX()) < W / 2 ? 0 : 1;
      if (lane == localLane) {
        return t.isAlive() ? t.getHealth().percentage() : 0;
      }
    }
    return 0;
  }

  private boolean princessAlive(BotView v, Team team, int localLane) {
    return laneTowerHpRatio(v, team, localLane) > 0;
  }

  private Candidate leakPlay(BotView v) {
    Candidate best = null;
    for (int slot = 0; slot < 4; slot++) {
      Card c = v.handCard(slot);
      if (c == null || !affordable(v, c) || c.getType() != CardType.TROOP) {
        continue;
      }
      int lane = rng.nextInt(2);
      best = better(best, new Candidate(slot, c, lane == 0 ? 6500 : 11500, 2000, 1 + (10 - c.getCost()) * 0.1));
    }
    return best;
  }

  private Candidate randomPlay(BotView v) {
    List<Integer> slots = new ArrayList<>();
    for (int slot = 0; slot < 4; slot++) {
      Card c = v.handCard(slot);
      if (c != null && affordable(v, c) && !c.isMirror()) {
        slots.add(slot);
      }
    }
    if (slots.isEmpty()) {
      return null;
    }
    int slot = slots.get(rng.nextInt(slots.size()));
    Card c = v.handCard(slot);
    int x;
    int y;
    if (c.getType() == CardType.SPELL && !c.isSpellAsDeploy()) {
      x = 1500 + rng.nextInt(15000);
      y = 16000 + rng.nextInt(12000);
    } else {
      x = 1000 + rng.nextInt(16000);
      y = 1500 + rng.nextInt(12000);
    }
    return new Candidate(slot, c, x, y, 0);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  private Decision finalise(BotView v, Candidate cand) {
    double jitter = p.placementJitterTiles() * 1000;
    int x = cand.x() + (int) Math.round((rng.nextDouble() * 2 - 1) * jitter);
    int y = cand.y() + (int) Math.round((rng.nextDouble() * 2 - 1) * jitter);
    x = clamp(x, 500, W - 500);
    y = clamp(y, 500, H - 500);
    // Convert to absolute coordinates and nudge onto a legal tile if needed.
    int ax = lx(v, x);
    int ay = ly(v, y);
    int[] legal = nearestLegal(v, cand.slot(), ax, ay);
    if (legal == null) {
      return null;
    }
    return new Decision(cand.slot(), cand.card().getId(), legal[0], legal[1]);
  }

  private int[] nearestLegal(BotView v, int slot, int x, int y) {
    if (v.isValidPlacement(slot, x, y)) {
      return new int[] {x, y};
    }
    // Spiral search over half-tile steps toward the bot's own side.
    for (int r = 1; r <= 12; r++) {
      for (int dx = -r; dx <= r; dx++) {
        for (int dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) != r) {
            continue;
          }
          int cx = x + dx * 500;
          int cy = y + dy * 500;
          if (cx < 250 || cx > W - 250 || cy < 250 || cy > H - 250) {
            continue;
          }
          if (v.isValidPlacement(slot, cx, cy)) {
            return new int[] {cx, cy};
          }
        }
      }
    }
    return null;
  }

  private void trackOpponent(BotView v) {
    if (deckIds.isEmpty()) {
      deckIds = v.deck();
    }
    if (!p.trackOpponent()) {
      return;
    }
    double dt = (v.tick() - lastTrackTick) / 20.0;
    lastTrackTick = v.tick();
    oppElixir = Math.min(10, oppElixir + dt * v.elixirMultiplier() / 2.8);
    List<BotView.SeenPlay> plays = v.opponentPlays();
    while (seenPlayCount < plays.size()) {
      BotView.SeenPlay sp = plays.get(seenPlayCount++);
      Card c = CardPool.get(sp.cardId());
      oppElixir = Math.max(0, oppElixir - (c != null ? c.getCost() : 3));
      oppRecent.addLast(sp.cardId());
      while (oppRecent.size() > 4) {
        oppRecent.removeFirst();
      }
    }
  }

  private Map<String, Double> buildUnitValues(List<String> deck) {
    Map<String, Double> m = new HashMap<>();
    for (String id : deck) {
      Card c = CardPool.get(id);
      if (c == null) {
        continue;
      }
      if (c.getUnitStats() != null) {
        m.put(c.getUnitStats().getName(), c.getCost() / (double) Math.max(1, c.getTotalDeployCount()));
      }
      if (c.getSummonTemplate() != null) {
        m.putIfAbsent(c.getSummonTemplate().getName(), 1.0);
      }
    }
    return m;
  }

  private double valueOf(Entity e) {
    Double v = unitValue != null ? unitValue.get(e.getName()) : null;
    if (v != null) {
      return v;
    }
    return clampD(e.getHealth().getMax() / 700.0, 0.3, 8);
  }

  private static double dps(Card c) {
    TroopStats u = c.getUnitStats();
    if (u == null) {
      return 0;
    }
    int dmg = u.getDamage();
    if (dmg == 0 && u.getProjectile() != null) {
      dmg = u.getProjectile().getDamage();
    }
    double count = Math.max(1, c.getTotalDeployCount());
    return LevelScaling.scaleCard(dmg, BattleSetup.LEVEL) / Math.max(0.3, u.getAttackCooldown()) * count;
  }

  private static boolean affordable(BotView v, Card c) {
    return v.elixir() >= c.getCost();
  }

  private static Candidate better(Candidate a, Candidate b) {
    if (a == null) {
      return b;
    }
    if (b == null) {
      return a;
    }
    return b.score() > a.score() ? b : a;
  }

  /** Converts between absolute and local x (the transform is its own inverse). */
  private static int lx(BotView v, int x) {
    return v.team() == Team.BLUE ? x : W - x;
  }

  private static int ly(BotView v, int y) {
    return v.team() == Team.BLUE ? y : H - y;
  }

  private static int clamp(int v, int lo, int hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  private static double clampD(double v, double lo, double hi) {
    return Math.max(lo, Math.min(hi, v));
  }
}
