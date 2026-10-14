package com.anyroyale.server.match;

import com.anyroyale.server.ServerConfig;
import com.anyroyale.server.arenas.ArenaCatalog;
import com.anyroyale.server.bots.BotBrain;
import com.anyroyale.server.bots.BotFactory;
import com.anyroyale.server.cards.SharedRandomDeckGenerator;
import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.replay.Replay;
import com.anyroyale.server.replay.ReplayStore;
import com.anyroyale.server.sessions.ClientChannel;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Function;
import org.crforge.core.player.Team;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Creates, tracks and tears down matches. Owns the tick scheduler, the shared-deck generator and
 * the replay store. Also the single place that knows which guest is in which match, so a
 * reconnecting browser is routed back to its seat and nobody can sit in two matches at once.
 */
public final class MatchManager implements MatchSession.Listener {

  private static final Logger log = LoggerFactory.getLogger(MatchManager.class);

  /** One side of a new match: a connected human or a bot. */
  public record Contestant(String guestId, String name, ClientChannel channel, BotBrain bot) {
    public static Contestant human(ClientChannel channel) {
      return new Contestant(channel.guestId(), channel.name(), channel, null);
    }

    public static Contestant bot(BotBrain bot, String name) {
      return new Contestant("bot_" + Long.toHexString(System.nanoTime()), name, null, bot);
    }
  }

  private final ServerConfig config;
  private final ScheduledExecutorService scheduler;
  private final SharedRandomDeckGenerator decks = new SharedRandomDeckGenerator();
  private final ReplayStore replays;
  private final SecureRandom random = new SecureRandom();
  private final Map<String, MatchSession> matches = new ConcurrentHashMap<>();
  private final Map<String, String> matchByGuest = new ConcurrentHashMap<>();
  private final AtomicLong matchesStarted = new AtomicLong();
  private final AtomicLong matchesFinished = new AtomicLong();
  private final AtomicInteger matchCounter = new AtomicInteger();
  private volatile Function<String, ClientChannel> channelLookup = id -> null;
  private volatile Consumer<String> requeue = id -> {};

  public MatchManager(ServerConfig config, ReplayStore replays) {
    this.config = config;
    this.replays = replays;
    AtomicInteger n = new AtomicInteger();
    ThreadFactory tf =
        r -> {
          Thread t = new Thread(r, "match-tick-" + n.incrementAndGet());
          t.setDaemon(true);
          return t;
        };
    ScheduledThreadPoolExecutor exec =
        (ScheduledThreadPoolExecutor) Executors.newScheduledThreadPool(config.tickThreads(), tf);
    exec.setRemoveOnCancelPolicy(true);
    this.scheduler = exec;
  }

  /** Lets rematches find the current connection of a guest (set by the WebSocket gateway). */
  public void setChannelLookup(Function<String, ClientChannel> lookup) {
    this.channelLookup = lookup;
  }

  /** Puts a guest whose online match was cancelled before it began back into the queue. */
  public void setRequeue(Consumer<String> requeue) {
    this.requeue = requeue;
  }

  public boolean atCapacity() {
    return matches.size() >= config.maxMatches();
  }

  /**
   * Creates and starts a match. Seats are assigned at random so neither queue order nor room
   * ownership decides who plays blue (the engine is rotation-symmetric, see FairnessTest).
   *
   * @param seed match seed, or null to draw a fresh one from SecureRandom
   */
  public MatchSession create(MatchMode mode, Contestant a, Contestant b, Long seed) {
    long matchSeed = seed != null ? seed : random.nextLong();
    boolean swap = random.nextBoolean();
    Contestant blue = swap ? b : a;
    Contestant red = swap ? a : b;
    String matchId = newMatchId();
    String difficulty =
        a.bot() != null ? a.bot().difficulty() : b.bot() != null ? b.bot().difficulty() : null;
    MatchConfig mc =
        new MatchConfig(
            matchId, matchSeed, decks.generate(matchSeed), ArenaCatalog.pick(matchSeed), mode, difficulty);
    MatchSession session =
        new MatchSession(
            mc,
            blue.guestId(),
            blue.name(),
            blue.bot(),
            red.guestId(),
            red.name(),
            red.bot(),
            this,
            config.reconnectGraceSeconds(),
            config.readyTimeoutSeconds(),
            System::currentTimeMillis);
    matches.put(matchId, session);
    for (Contestant c : List.of(blue, red)) {
      if (c.bot() == null) {
        matchByGuest.put(c.guestId(), matchId);
      }
    }
    session.start(scheduler);
    for (Contestant c : List.of(blue, red)) {
      if (c.channel() != null) {
        session.attach(c.channel());
      }
    }
    matchesStarted.incrementAndGet();
    log.info(
        "Match {} created: mode={} arena={} deck={} blue={} red={}",
        matchId,
        mode.wire(),
        mc.arena().id(),
        mc.deck().cardIds(),
        blue.name(),
        red.name());
    return session;
  }

  public MatchSession activeMatchOf(String guestId) {
    String id = matchByGuest.get(guestId);
    return id == null ? null : matches.get(id);
  }

  /** Detaches a guest from a finished match so they can start a new one immediately. */
  public void releaseGuest(String guestId, String matchId) {
    matchByGuest.remove(guestId, matchId);
  }

  public MatchSession get(String matchId) {
    return matches.get(matchId);
  }

  public Collection<MatchSession> all() {
    return new ArrayList<>(matches.values());
  }

  public long started() {
    return matchesStarted.get();
  }

  public long finished() {
    return matchesFinished.get();
  }

  @Override
  public void onEnded(MatchSession session, Replay replay) {
    matchesFinished.incrementAndGet();
    replays.save(replay);
  }

  @Override
  public void onRematch(MatchSession old, boolean sameDeck) {
    List<Contestant> contestants = new ArrayList<>(2);
    for (Team team : Team.values()) {
      BotBrain bot = old.botOf(team);
      if (bot != null) {
        contestants.add(Contestant.bot(BotFactory.create(bot.difficulty(), random.nextLong()), old.nameOf(team)));
      } else {
        ClientChannel ch = channelLookup.apply(old.guestOf(team));
        if (ch == null || !ch.isOpen()) {
          return; // the player left meanwhile; nothing to start
        }
        contestants.add(Contestant.human(ch));
      }
    }
    // Free the guests before the new match registers them.
    for (String g : old.humanGuestIds()) {
      matchByGuest.remove(g, old.id());
    }
    Long seed = sameDeck ? old.config().seed() : null;
    create(old.config().mode(), contestants.get(0), contestants.get(1), seed);
  }

  @Override
  public void onClosed(MatchSession session) {
    matches.remove(session.id());
    for (String g : session.humanGuestIds()) {
      matchByGuest.remove(g, session.id());
    }
  }

  @Override
  public void onCancelled(MatchSession session, List<String> requeueGuestIds) {
    for (String g : requeueGuestIds) {
      try {
        requeue.accept(g);
      } catch (RuntimeException e) {
        log.warn("Could not requeue {} after match {} was cancelled", g, session.id(), e);
      }
    }
  }

  /** Gracefully stops every match (SIGTERM on Render). */
  public void shutdown() {
    for (MatchSession s : matches.values()) {
      s.shutdown("Server is restarting. Please reconnect in a moment.");
    }
    scheduler.shutdown();
    try {
      if (!scheduler.awaitTermination(3, TimeUnit.SECONDS)) {
        scheduler.shutdownNow();
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      scheduler.shutdownNow();
    }
  }

  public ReplayStore replays() {
    return replays;
  }

  private String newMatchId() {
    return "m" + Long.toString(System.currentTimeMillis(), 36) + matchCounter.incrementAndGet();
  }
}
