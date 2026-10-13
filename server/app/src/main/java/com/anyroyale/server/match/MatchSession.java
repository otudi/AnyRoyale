package com.anyroyale.server.match;

import com.anyroyale.server.bots.BotBrain;
import com.anyroyale.server.bots.BotView;
import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.replay.Replay;
import com.anyroyale.server.sessions.ClientChannel;
import com.anyroyale.server.util.Json;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import org.crforge.core.card.Card;
import org.crforge.core.card.CardType;
import org.crforge.core.effect.AppliedEffect;
import org.crforge.core.effect.StatusEffectType;
import org.crforge.core.engine.AoeDamageEvent;
import org.crforge.core.engine.GameEngine;
import org.crforge.core.engine.GameState;
import org.crforge.core.entity.base.Entity;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.match.Standard1v1Match;
import org.crforge.core.player.Player;
import org.crforge.core.player.Team;
import org.crforge.core.player.dto.PlayerActionDTO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * One authoritative battle.
 *
 * <p>Threading: every mutation happens on the match's tick task (a fixed-rate task on a shared
 * scheduler, which never runs the same task concurrently). Network threads only enqueue commands
 * into {@link #inbox}; they never touch the engine. The engine therefore needs no locking.
 *
 * <p>Authority: clients only send intents ("play card X from slot N at (x,y)"). The server checks
 * the slot, the card, elixir and placement, queues the action into crforge, ticks the simulation
 * at 20 TPS and streams full-state snapshots at 10 Hz. Elixir, damage, health and the winner are
 * only ever computed here.
 */
public final class MatchSession {

  private static final Logger log = LoggerFactory.getLogger(MatchSession.class);

  public static final int TICK_MS = 1000 / GameEngine.TICKS_PER_SECOND;
  private static final int SNAPSHOT_EVERY_TICKS = 2;
  private static final int INTRO_TICKS = 3 * GameEngine.TICKS_PER_SECOND;
  private static final int REMATCH_WINDOW_TICKS = 60 * GameEngine.TICKS_PER_SECOND;
  private static final int MAX_PENDING_PLAYS = 6;

  public enum State {
    WAITING_READY,
    INTRO,
    RUNNING,
    ENDED,
    CLOSED
  }

  /** Callbacks to the owner (MatchManager). Invoked on the match thread. */
  public interface Listener {
    void onEnded(MatchSession session, Replay replay);

    /** Both players asked for a rematch (or the bot match player did). */
    void onRematch(MatchSession session, boolean sameDeck);

    void onClosed(MatchSession session);
  }

  /** Read-only clock data handed to the snapshot writer. */
  public record Clock(int tick, double timeLeftSeconds, String phase, int elixirMultiplier) {}

  private record PlayCommand(long seq, int handIndex, String cardId, int x, int y) {}

  private static final class Seat {
    final Team team;
    final String guestId;
    final String name;
    final BotBrain bot;
    volatile ClientChannel channel;
    boolean everConnected;
    boolean ready;
    long disconnectedAtMs = -1;
    long lastSeq;
    boolean wantsRematch;
    boolean rematchSameDeck;
    final Deque<PlayCommand> pending = new ArrayDeque<>();

    Seat(Team team, String guestId, String name, BotBrain bot) {
      this.team = team;
      this.guestId = guestId;
      this.name = name;
      this.bot = bot;
    }

    boolean isHuman() {
      return bot == null;
    }

    boolean connected() {
      ClientChannel c = channel;
      return bot != null || (c != null && c.isOpen());
    }
  }

  private final MatchConfig config;
  private final BattleSetup battle;
  private final Seat blue;
  private final Seat red;
  private final Listener listener;
  private final int reconnectGraceMs;
  private final int readyTimeoutMs;
  private final LongSupplier clockMs;
  private final Queue<Runnable> inbox = new ConcurrentLinkedQueue<>();
  private final SpellAttribution spells = new SpellAttribution();
  private final List<Replay.Action> actions = new ArrayList<>();
  private final List<Object[]> pendingEvents = new ArrayList<>();
  private final Map<Team, List<BotView.SeenPlay>> seenPlays = new HashMap<>();
  private final Map<Long, Object[]> lastAlive = new HashMap<>();
  private final Set<Long> attackingLastTick = new HashSet<>();
  private final long createdAtMs;
  private final MatchStats stats = new MatchStats();

  private volatile State state = State.WAITING_READY;
  private ScheduledFuture<?> future;
  private int introTicksLeft = INTRO_TICKS;
  private int endedTicks;
  private String lastPhase = "regular";
  private Team forfeitLoser;
  private String endReason;
  private Replay replay;
  private long startedAtMs;

  public MatchSession(
      MatchConfig config,
      String blueGuestId,
      String blueName,
      BotBrain blueBot,
      String redGuestId,
      String redName,
      BotBrain redBot,
      Listener listener,
      int reconnectGraceSeconds,
      int readyTimeoutSeconds,
      LongSupplier clockMs) {
    this.config = config;
    this.battle =
        BattleSetup.create(config.seed(), config.deck().cards(), blueBot != null, redBot != null);
    this.blue = new Seat(Team.BLUE, blueGuestId, blueName, blueBot);
    this.red = new Seat(Team.RED, redGuestId, redName, redBot);
    this.listener = listener;
    this.reconnectGraceMs = reconnectGraceSeconds * 1000;
    this.readyTimeoutMs = readyTimeoutSeconds * 1000;
    this.clockMs = clockMs;
    this.createdAtMs = clockMs.getAsLong();
    seenPlays.put(Team.BLUE, new ArrayList<>());
    seenPlays.put(Team.RED, new ArrayList<>());
    if (blueBot != null) {
      blue.ready = true;
    }
    if (redBot != null) {
      red.ready = true;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Public, thread-safe API (called from network threads): everything is posted to the inbox.
  // ---------------------------------------------------------------------------------------------

  public void start(ScheduledExecutorService scheduler) {
    future = scheduler.scheduleAtFixedRate(this::safeLoop, 0, TICK_MS, TimeUnit.MILLISECONDS);
  }

  /** Binds (or re-binds after reconnect) a browser connection to its seat. */
  public void attach(ClientChannel channel) {
    inbox.add(() -> doAttach(channel));
  }

  public void detach(ClientChannel channel) {
    inbox.add(() -> doDetach(channel));
  }

  public void ready(String guestId) {
    inbox.add(
        () -> {
          Seat s = seatOf(guestId);
          if (s != null) {
            s.ready = true;
          }
        });
  }

  public void play(String guestId, long seq, int handIndex, String cardId, int x, int y) {
    inbox.add(() -> enqueuePlay(guestId, new PlayCommand(seq, handIndex, cardId, x, y)));
  }

  public void leave(String guestId) {
    inbox.add(() -> doLeave(guestId));
  }

  public void requestRematch(String guestId, boolean sameDeck) {
    inbox.add(() -> doRematch(guestId, sameDeck));
  }

  /** Stops the match without a result (server shutdown). */
  public void shutdown(String reason) {
    inbox.add(
        () -> {
          ObjectNode msg = Json.obj().put("type", "serverShutdown").put("reason", reason);
          broadcast(msg.toString());
          close();
        });
  }

  public String id() {
    return config.matchId();
  }

  public MatchConfig config() {
    return config;
  }

  public State state() {
    return state;
  }

  public boolean hasGuest(String guestId) {
    return guestId != null && (guestId.equals(blue.guestId) || guestId.equals(red.guestId));
  }

  public List<String> humanGuestIds() {
    List<String> ids = new ArrayList<>(2);
    if (blue.isHuman()) {
      ids.add(blue.guestId);
    }
    if (red.isHuman()) {
      ids.add(red.guestId);
    }
    return ids;
  }

  public String nameOf(Team team) {
    return seat(team).name;
  }

  public BotBrain botOf(Team team) {
    return seat(team).bot;
  }

  public String guestOf(Team team) {
    return seat(team).guestId;
  }

  public MatchStats stats() {
    return stats;
  }

  /**
   * Runs one loop iteration on the calling thread instead of the scheduler. Tests use it to play
   * whole matches deterministically and much faster than real time.
   */
  void stepForTests() {
    safeLoop();
  }

  /** Engine access for tests only (call from the match thread or after the match closed). */
  BattleSetup battleForTests() {
    return battle;
  }

  // ---------------------------------------------------------------------------------------------
  // Match thread
  // ---------------------------------------------------------------------------------------------

  private void safeLoop() {
    long t0 = System.nanoTime();
    try {
      loop();
    } catch (Throwable t) {
      log.error("Match {} crashed; closing it", config.matchId(), t);
      ObjectNode msg = Json.obj().put("type", "error").put("code", "matchCrashed");
      msg.put("message", "The match hit a server error and was stopped.");
      broadcast(msg.toString());
      close();
    } finally {
      stats.recordLoop(System.nanoTime() - t0);
    }
  }

  private void loop() {
    Runnable r;
    while ((r = inbox.poll()) != null) {
      r.run();
    }
    switch (state) {
      case WAITING_READY -> waitForReady();
      case INTRO -> intro();
      case RUNNING -> runTick();
      case ENDED -> lingerAfterEnd();
      case CLOSED -> {}
    }
  }

  private void waitForReady() {
    long now = clockMs.getAsLong();
    for (Seat s : seats()) {
      if (s.isHuman() && !s.connected() && now - createdAtMs > reconnectGraceMs) {
        // A player never arrived (or vanished before the battle started): cancel without result.
        Seat other = other(s);
        sendTo(
            other,
            Json.obj().put("type", "matchCancelled").put("reason", "opponentMissing").toString());
        close();
        return;
      }
    }
    boolean allReady = blue.ready && red.ready;
    if (allReady || now - createdAtMs > readyTimeoutMs) {
      state = State.INTRO;
      broadcast(
          Json.obj()
              .put("type", "intro")
              .put("seconds", INTRO_TICKS / GameEngine.TICKS_PER_SECOND)
              .toString());
    }
  }

  private void intro() {
    if (--introTicksLeft <= 0) {
      state = State.RUNNING;
      startedAtMs = clockMs.getAsLong();
      broadcast(Json.obj().put("type", "battleStart").toString());
      sendSnapshots();
    }
  }

  private void runTick() {
    GameEngine engine = battle.engine;
    GameState gs = engine.getGameState();
    int frame = gs.getFrameCount();
    spells.setTick(frame);

    // 1. Bots decide (through the same queue and validation as humans).
    for (Seat s : seats()) {
      if (s.bot != null && s.pending.isEmpty()) {
        BotBrain.Decision d = s.bot.think(botView(s));
        if (d != null) {
          s.pending.add(new PlayCommand(++s.lastSeq, d.handIndex(), d.cardId(), d.x(), d.y()));
        }
      }
    }

    // 2. At most one accepted play per seat per tick: the hand only cycles inside engine.tick(),
    //    so a second play in the same tick would be validated against a stale hand.
    applyPendingPlay(blue);
    applyPendingPlay(red);

    // 3. Simulate one tick.
    engine.tick();
    collectEvents(gs);

    // 4. Disconnect handling: a player away longer than the grace period forfeits.
    checkDisconnects();

    if (!engine.isRunning() || battle.match.isEnded() || forfeitLoser != null) {
      finish();
      return;
    }
    if (gs.getFrameCount() % SNAPSHOT_EVERY_TICKS == 0) {
      sendSnapshots();
    }
  }

  private void applyPendingPlay(Seat seat) {
    while (!seat.pending.isEmpty()) {
      PlayCommand cmd = seat.pending.poll();
      String reason = tryPlay(seat, cmd);
      if (reason == null) {
        sendTo(seat, Json.obj().put("type", "ack").put("seq", cmd.seq()).toString());
        return;
      }
      if (seat.isHuman()) {
        sendTo(
            seat,
            Json.obj()
                .put("type", "reject")
                .put("seq", cmd.seq())
                .put("reason", reason)
                .toString());
      }
      stats.rejected++;
    }
  }

  /** Validates and queues a play. Returns null on success, else a rejection reason. */
  private String tryPlay(Seat seat, PlayCommand cmd) {
    Player player = battle.player(seat.team);
    if (cmd.handIndex() < 0 || cmd.handIndex() > 3) {
      return "badSlot";
    }
    Card card = player.getHand().getCard(cmd.handIndex());
    if (card == null || !card.getId().equals(cmd.cardId())) {
      return "staleHand";
    }
    int cost = card.getCost();
    if (card.isMirror()) {
      Card last = player.getLastPlayedCard();
      if (last == null || last.isMirror()) {
        return "nothingToMirror";
      }
      cost = Math.min(last.getCost() + 1, 10);
    }
    if (player.getElixir().getCurrent() < cost) {
      return "elixir";
    }
    PlayerActionDTO action = PlayerActionDTO.play(cmd.handIndex(), cmd.x(), cmd.y());
    if (!battle.match.validateAction(player, action)) {
      return "placement";
    }
    int frame = battle.engine.getGameState().getFrameCount();
    battle.engine.queueAction(player, action);
    actions.add(
        new Replay.Action(frame, seat.team.name(), cmd.handIndex(), card.getId(), cmd.x(), cmd.y()));
    Card effective = card.isMirror() ? player.getLastPlayedCard() : card;
    String shownId = effective != null ? effective.getId() : card.getId();
    pendingEvents.add(new Object[] {"play", teamIndex(seat.team), shownId, cmd.x(), cmd.y()});
    if (effective != null && effective.getType() == CardType.SPELL) {
      spells.onSpellPlayed(seat.team, effective.getId(), cmd.x(), cmd.y(), frame);
    }
    seenPlays.get(seat.team).add(new BotView.SeenPlay(frame, shownId, cmd.x(), cmd.y()));
    stats.plays++;
    return null;
  }

  private void collectEvents(GameState gs) {
    for (AoeDamageEvent ev : gs.getAoeDamageEvents()) {
      pendingEvents.add(
          new Object[] {"aoe", ev.centerX(), ev.centerY(), ev.radius(), teamIndex(ev.sourceTeam())});
    }
    Map<Long, Object[]> nowAlive = new HashMap<>();
    Set<Long> attackingNow = new HashSet<>();
    for (Entity e : gs.getAliveEntities()) {
      nowAlive.put(
          e.getId(),
          new Object[] {
            e.getName(), e.getPosition().getX(), e.getPosition().getY(), teamIndex(e.getTeam()),
            e instanceof Tower t ? (t.isCrownTower() ? "K" : "P") : ""
          });
      if (e.getCombat() != null) {
        if (e.getCombat().isAttacking()) {
          attackingNow.add(e.getId());
        } else if (attackingLastTick.contains(e.getId()) && !isDisabled(e)) {
          Entity target = e.getCombat().getCurrentTarget();
          pendingEvents.add(new Object[] {"hit", e.getId(), target != null ? target.getId() : 0});
        }
      }
    }
    for (Map.Entry<Long, Object[]> prev : lastAlive.entrySet()) {
      if (!nowAlive.containsKey(prev.getKey())) {
        Object[] p = prev.getValue();
        pendingEvents.add(new Object[] {"die", prev.getKey(), p[0], p[1], p[2], p[3], p[4]});
      }
    }
    lastAlive.clear();
    lastAlive.putAll(nowAlive);
    attackingLastTick.clear();
    attackingLastTick.addAll(attackingNow);

    String phase = clock().phase();
    if (!phase.equals(lastPhase)) {
      pendingEvents.add(new Object[] {"phase", phase});
      lastPhase = phase;
    }
  }

  private static boolean isDisabled(Entity e) {
    for (AppliedEffect eff : e.getAppliedEffects()) {
      if (eff.getType() == StatusEffectType.STUN || eff.getType() == StatusEffectType.FREEZE) {
        return true;
      }
    }
    return false;
  }

  private void checkDisconnects() {
    long now = clockMs.getAsLong();
    boolean blueGone = isGoneTooLong(blue, now);
    boolean redGone = isGoneTooLong(red, now);
    if (blueGone && redGone) {
      endReason = "abandoned";
      battle.engine.stop();
      battle.match.setDraw(true);
    } else if (blueGone) {
      forfeit(Team.BLUE, "disconnect");
    } else if (redGone) {
      forfeit(Team.RED, "disconnect");
    }
  }

  private boolean isGoneTooLong(Seat s, long now) {
    return s.isHuman()
        && !s.connected()
        && s.disconnectedAtMs >= 0
        && now - s.disconnectedAtMs > reconnectGraceMs;
  }

  private void forfeit(Team loser, String reason) {
    if (forfeitLoser != null || battle.match.isEnded()) {
      return;
    }
    forfeitLoser = loser;
    endReason = reason;
    battle.engine.stop();
    battle.match.setWinner(loser.opposite());
  }

  private void finish() {
    if (state == State.ENDED || state == State.CLOSED) {
      return;
    }
    sendSnapshots();
    state = State.ENDED;
    GameState gs = battle.engine.getGameState();
    // The engine records a king-tower kill on GameState; time/forfeit results on the Match.
    Team winner = battle.match.getWinner() != null ? battle.match.getWinner() : gs.getWinner();
    boolean draw = winner == null;
    int blueCrowns = gs.getCrownCount(Team.BLUE);
    int redCrowns = gs.getCrownCount(Team.RED);
    int blueHp = towerHp(Team.BLUE);
    int redHp = towerHp(Team.RED);
    String reason = endReason;
    if (reason == null) {
      if (winner != null && !gs.getCrownTower(winner.opposite()).isAlive()) {
        reason = "kingTower";
      } else if (draw) {
        reason = "draw";
      } else if (blueCrowns != redCrowns) {
        reason = "crowns";
      } else {
        reason = "towerHp";
      }
    }
    replay =
        new Replay(
            config.matchId(),
            config.mode().wire(),
            config.seed(),
            config.arena().id(),
            config.deck().cardIds(),
            BattleSetup.LEVEL,
            blue.name,
            red.name,
            startedAtMs,
            List.copyOf(actions),
            new Replay.Result(
                draw ? null : winner.name(),
                draw,
                reason,
                blueCrowns,
                redCrowns,
                blueHp,
                redHp,
                gs.getFrameCount()));
    for (Seat s : seats()) {
      ObjectNode msg = Json.obj().put("type", "end");
      msg.put("matchId", config.matchId());
      msg.put("winner", draw ? null : winner.name());
      msg.put("draw", draw);
      msg.put("youWon", !draw && winner == s.team);
      msg.put("reason", reason);
      ObjectNode crowns = msg.putObject("crowns");
      crowns.put("BLUE", blueCrowns).put("RED", redCrowns);
      ObjectNode hp = msg.putObject("towerHp");
      hp.put("BLUE", blueHp).put("RED", redHp);
      msg.put("seconds", gs.getFrameCount() / GameEngine.TICKS_PER_SECOND);
      msg.put("canRematch", true);
      sendTo(s, msg.toString());
    }
    log.info(
        "Match {} ended: winner={} reason={} crowns {}-{} frames={} plays={}",
        config.matchId(),
        draw ? "draw" : winner,
        reason,
        blueCrowns,
        redCrowns,
        gs.getFrameCount(),
        actions.size());
    listener.onEnded(this, replay);
  }

  private int towerHp(Team team) {
    int total = 0;
    for (Tower t : battle.engine.getGameState().getTowers().get(team)) {
      if (t.isAlive()) {
        total += t.getHealth().getCurrent();
      }
    }
    return total;
  }

  private void lingerAfterEnd() {
    endedTicks++;
    boolean humansWant = true;
    boolean sameDeck = true;
    for (Seat s : seats()) {
      if (s.isHuman()) {
        humansWant &= s.wantsRematch;
        sameDeck &= s.rematchSameDeck;
      }
    }
    if (humansWant) {
      listener.onRematch(this, sameDeck);
      close();
      return;
    }
    boolean anyoneConnected = false;
    for (Seat s : seats()) {
      if (s.isHuman() && s.connected()) {
        anyoneConnected = true;
      }
    }
    if (endedTicks > REMATCH_WINDOW_TICKS || !anyoneConnected) {
      close();
    }
  }

  private void close() {
    if (state == State.CLOSED) {
      return;
    }
    state = State.CLOSED;
    if (future != null) {
      future.cancel(false);
    }
    listener.onClosed(this);
  }

  // ---------------------------------------------------------------------------------------------
  // Inbox handlers (run on the match thread)
  // ---------------------------------------------------------------------------------------------

  private void doAttach(ClientChannel channel) {
    Seat s = seatOf(channel.guestId());
    if (s == null || s.bot != null) {
      return;
    }
    ClientChannel previous = s.channel;
    s.channel = channel;
    boolean reconnect = s.everConnected;
    s.everConnected = true;
    s.disconnectedAtMs = -1;
    if (previous != null && previous != channel && previous.isOpen()) {
      previous.send(Json.obj().put("type", "replaced").toString());
    }
    channel.send(matchStartMessage(s, reconnect).toString());
    if (state == State.RUNNING || state == State.ENDED) {
      sendSnapshotTo(s);
    }
    if (reconnect) {
      sendTo(other(s), Json.obj().put("type", "opponentStatus").put("connected", true).toString());
    }
  }

  private void doDetach(ClientChannel channel) {
    Seat s = seatOf(channel.guestId());
    if (s == null || s.channel != channel) {
      return; // a newer connection already replaced this one
    }
    s.channel = null;
    s.disconnectedAtMs = clockMs.getAsLong();
    if (state == State.RUNNING || state == State.INTRO || state == State.WAITING_READY) {
      sendTo(
          other(s),
          Json.obj()
              .put("type", "opponentStatus")
              .put("connected", false)
              .put("graceSeconds", reconnectGraceMs / 1000)
              .toString());
    }
  }

  private void enqueuePlay(String guestId, PlayCommand cmd) {
    Seat s = seatOf(guestId);
    if (s == null || s.bot != null) {
      return;
    }
    if (cmd.seq() <= s.lastSeq) {
      return; // duplicate or replayed command
    }
    s.lastSeq = cmd.seq();
    if (state != State.RUNNING) {
      sendTo(
          s,
          Json.obj().put("type", "reject").put("seq", cmd.seq()).put("reason", "notRunning").toString());
      return;
    }
    if (s.pending.size() >= MAX_PENDING_PLAYS) {
      sendTo(
          s,
          Json.obj().put("type", "reject").put("seq", cmd.seq()).put("reason", "rateLimited").toString());
      return;
    }
    s.pending.add(cmd);
  }

  private void doLeave(String guestId) {
    Seat s = seatOf(guestId);
    if (s == null) {
      return;
    }
    switch (state) {
      case WAITING_READY, INTRO -> {
        sendTo(
            other(s),
            Json.obj().put("type", "matchCancelled").put("reason", "opponentLeft").toString());
        close();
      }
      case RUNNING -> forfeit(s.team, "surrender");
      case ENDED -> {
        // A rematch needs both players, so once one leaves there is nothing left to wait for.
        s.wantsRematch = false;
        sendTo(
            other(s),
            Json.obj().put("type", "rematchStatus").put("opponentLeft", true).toString());
        close();
      }
      default -> {}
    }
  }

  private void doRematch(String guestId, boolean sameDeck) {
    Seat s = seatOf(guestId);
    if (s == null || state != State.ENDED) {
      return;
    }
    s.wantsRematch = true;
    s.rematchSameDeck = sameDeck;
    Seat o = other(s);
    if (o.isHuman()) {
      sendTo(o, Json.obj().put("type", "rematchStatus").put("opponentWants", true).toString());
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------------------------

  private ObjectNode matchStartMessage(Seat s, boolean resume) {
    ObjectNode msg = Json.obj().put("type", "matchStart");
    msg.put("matchId", config.matchId());
    msg.put("resume", resume);
    msg.put("mode", config.mode().wire());
    msg.put("you", s.team.name());
    msg.put("seed", Long.toString(config.seed()));
    msg.put("level", BattleSetup.LEVEL);
    ObjectNode arena = msg.putObject("arena");
    arena.put("id", config.arena().id());
    arena.put("number", config.arena().number());
    arena.put("name", config.arena().name());
    arena.put("nameAr", config.arena().nameAr());
    ArrayNode deck = msg.putArray("deck");
    config.deck().cardIds().forEach(deck::add);
    Seat o = other(s);
    ObjectNode opp = msg.putObject("opponent");
    opp.put("name", o.name);
    opp.put("bot", o.bot != null);
    if (o.bot != null) {
      opp.put("difficulty", o.bot.difficulty());
    }
    msg.put("state", state.name());
    msg.put("durationSeconds", Standard1v1Match.MATCH_DURATION_TICKS / GameEngine.TICKS_PER_SECOND);
    msg.put(
        "overtimeSeconds", Standard1v1Match.OVERTIME_DURATION_TICKS / GameEngine.TICKS_PER_SECOND);
    return msg;
  }

  private void sendSnapshots() {
    List<Object[]> events = new ArrayList<>(pendingEvents);
    pendingEvents.clear();
    for (Seat s : seats()) {
      if (s.isHuman() && s.connected()) {
        sendTo(s, snapshotFor(s, events));
      }
    }
  }

  private void sendSnapshotTo(Seat s) {
    sendTo(s, snapshotFor(s, List.of()));
  }

  private String snapshotFor(Seat s, List<Object[]> events) {
    GameState gs = battle.engine.getGameState();
    stats.snapshots++;
    return SnapshotWriter.write(
        clock(),
        gs,
        gs.getProjectiles(),
        battle.player(s.team),
        gs.getCrownCount(s.team.opposite()),
        gs.getCrownCount(s.team),
        events,
        spells);
  }

  public Clock clock() {
    GameEngine engine = battle.engine;
    int frame = engine.getGameState().getFrameCount();
    int regular = battle.match.getMatchDurationTicks();
    int overtime = battle.match.getOvertimeDurationTicks();
    double left;
    String phase;
    int mult = engine.getElixirMultiplier();
    if (battle.match.isOvertime()) {
      left = Math.max(0, regular + overtime - frame) / (double) GameEngine.TICKS_PER_SECOND;
      phase = mult >= 3 ? "triple" : "overtime";
    } else {
      left = Math.max(0, regular - frame) / (double) GameEngine.TICKS_PER_SECOND;
      phase = mult >= 2 ? "double" : "regular";
    }
    return new Clock(frame, left, phase, mult);
  }

  private BotView botView(Seat s) {
    Clock c = clock();
    return new BotView(
        battle.match,
        battle.engine.getGameState(),
        battle.player(s.team),
        c.tick(),
        battle.match.isOvertime(),
        c.elixirMultiplier(),
        (float) c.timeLeftSeconds(),
        seenPlays.get(s.team.opposite()),
        config.deck().cardIds());
  }

  private void broadcast(String json) {
    for (Seat s : seats()) {
      sendTo(s, json);
    }
  }

  private void sendTo(Seat s, String json) {
    ClientChannel c = s.channel;
    if (s.isHuman() && c != null && c.isOpen()) {
      c.send(json);
      stats.bytesOut += json.length();
    }
  }

  private Seat seatOf(String guestId) {
    if (guestId == null) {
      return null;
    }
    if (guestId.equals(blue.guestId)) {
      return blue;
    }
    if (guestId.equals(red.guestId)) {
      return red;
    }
    return null;
  }

  private Seat seat(Team team) {
    return team == Team.BLUE ? blue : red;
  }

  private Seat other(Seat s) {
    return s == blue ? red : blue;
  }

  private Collection<Seat> seats() {
    return List.of(blue, red);
  }

  private static int teamIndex(Team team) {
    return team == Team.BLUE ? 0 : 1;
  }

  public Replay replay() {
    return replay;
  }
}
