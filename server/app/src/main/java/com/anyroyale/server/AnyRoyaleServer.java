package com.anyroyale.server;

import com.anyroyale.server.arenas.ArenaCatalog;
import com.anyroyale.server.cards.CardCatalog;
import com.anyroyale.server.cards.CardPool;
import com.anyroyale.server.match.MatchManager;
import com.anyroyale.server.match.MatchSession;
import com.anyroyale.server.matchmaking.Matchmaker;
import com.anyroyale.server.replay.Replay;
import com.anyroyale.server.replay.ReplayStore;
import com.anyroyale.server.rooms.PrivateRoomManager;
import com.anyroyale.server.sessions.GuestSessionManager;
import com.anyroyale.server.util.Json;
import com.anyroyale.server.websocket.GameGateway;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.management.OperatingSystemMXBean;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * AnyRoyale server: one process serving the built web client, the REST/health endpoints and the
 * WebSocket game protocol, with every match simulated authoritatively by the crforge engine.
 */
public final class AnyRoyaleServer {

  private static final Logger log = LoggerFactory.getLogger(AnyRoyaleServer.class);

  private final ServerConfig config;
  private final MatchManager matches;
  private final Matchmaker matchmaker;
  private final PrivateRoomManager rooms;
  private final GameGateway gateway;
  private final long startedAtMs = System.currentTimeMillis();
  private final AtomicBoolean stopping = new AtomicBoolean();
  private Javalin app;

  public AnyRoyaleServer(ServerConfig config) {
    this.config = config;
    ReplayStore replays = new ReplayStore(config.replayDir());
    this.matches = new MatchManager(config, replays);
    this.matchmaker = new Matchmaker(matches);
    this.rooms = new PrivateRoomManager(matches);
    this.gateway =
        new GameGateway(new GuestSessionManager(config.sessionSecret()), matches, matchmaker, rooms);
  }

  public static void main(String[] args) {
    ServerConfig config = ServerConfig.fromEnv();
    AnyRoyaleServer server = new AnyRoyaleServer(config);
    server.start();
    Runtime.getRuntime().addShutdownHook(new Thread(server::stop, "shutdown"));
  }

  public AnyRoyaleServer start() {
    // Force card data loading (and its validation) before accepting traffic.
    int pool = CardPool.size();
    String cardsJson = CardCatalog.json();
    String arenasJson = arenasJson();
    app =
        Javalin.create(
            cfg -> {
              cfg.startup.showJavalinBanner = false;
              cfg.http.maxRequestSize = 16 * 1024;
              if (config.staticDir() != null) {
                cfg.staticFiles.add(
                    sf -> {
                      sf.hostedPath = "/";
                      sf.directory = config.staticDir().toString();
                      sf.location = Location.EXTERNAL;
                      sf.headers.put("Cache-Control", "public, max-age=300");
                    });
                cfg.staticFiles.add(
                    sf -> {
                      // Vite emits content-hashed file names under /assets: cache them forever.
                      sf.hostedPath = "/assets";
                      sf.directory = config.staticDir().resolve("assets").toString();
                      sf.location = Location.EXTERNAL;
                      sf.headers.put("Cache-Control", "public, max-age=31536000, immutable");
                    });
                if (Files.exists(config.staticDir().resolve("index.html"))) {
                  cfg.spaRoot.addFile(
                      "/", config.staticDir().resolve("index.html").toString(), Location.EXTERNAL);
                }
              }
              cfg.routes.get(
                  "/healthz",
                  ctx -> {
                    if (stopping.get()) {
                      ctx.status(503).json(Json.obj().put("status", "stopping"));
                    } else {
                      ctx.contentType("application/json")
                          .result(
                              Json.obj()
                                  .put("status", "ok")
                                  .put("matches", matches.all().size())
                                  .put("cards", pool)
                                  .toString());
                    }
                  });
              cfg.routes.get(
                  "/api/cards",
                  ctx ->
                      ctx.header("Cache-Control", "public, max-age=300")
                          .contentType("application/json")
                          .result(cardsJson));
              cfg.routes.get(
                  "/api/arenas",
                  ctx -> ctx.contentType("application/json").result(arenasJson));
              cfg.routes.get(
                  "/api/stats", ctx -> ctx.contentType("application/json").result(statsJson()));
              cfg.routes.get(
                  "/api/replays/{id}",
                  ctx -> {
                    Replay r = matches.replays().get(ctx.pathParam("id"));
                    if (r == null) {
                      ctx.status(404).result("{\"error\":\"notFound\"}");
                    } else {
                      ctx.contentType("application/json").result(Json.write(r));
                    }
                  });
              cfg.routes.ws("/ws", gateway::configure);
            });
    app.start(config.host(), config.port());
    log.info(
        "AnyRoyale server listening on {}:{} (cards in pool: {}, static: {}, tick threads: {})",
        config.host(),
        app.port(),
        pool,
        config.staticDir(),
        config.tickThreads());
    return this;
  }

  public int port() {
    return app.port();
  }

  public void stop() {
    if (!stopping.compareAndSet(false, true)) {
      return;
    }
    log.info("Shutting down: closing {} matches", matches.all().size());
    matches.shutdown();
    gateway.closeAll();
    if (app != null) {
      app.stop();
    }
    log.info("Shutdown complete");
  }

  private static String arenasJson() {
    ArrayNode arr = Json.MAPPER.createArrayNode();
    for (ArenaCatalog.ArenaInfo a : ArenaCatalog.all()) {
      arr.add(
          Json.obj()
              .put("id", a.id())
              .put("number", a.number())
              .put("name", a.name())
              .put("nameAr", a.nameAr()));
    }
    return Json.obj().set("arenas", arr).toString();
  }

  private String statsJson() {
    MemoryMXBean mem = ManagementFactory.getMemoryMXBean();
    ObjectNode n = Json.obj();
    n.put("uptimeSeconds", (System.currentTimeMillis() - startedAtMs) / 1000);
    n.put("connections", gateway.connections());
    n.put("connectionsTotal", gateway.connectionsTotal());
    n.put("queue", matchmaker.size());
    n.put("rooms", rooms.size());
    n.put("activeMatches", matches.all().size());
    n.put("matchesStarted", matches.started());
    n.put("matchesFinished", matches.finished());
    n.put("heapUsedMb", mem.getHeapMemoryUsage().getUsed() / (1024 * 1024));
    n.put("heapMaxMb", mem.getHeapMemoryUsage().getMax() / (1024 * 1024));
    if (ManagementFactory.getOperatingSystemMXBean() instanceof OperatingSystemMXBean os) {
      n.put("processCpuLoad", Math.round(os.getProcessCpuLoad() * 1000) / 1000.0);
      n.put("systemCpuLoad", Math.round(os.getCpuLoad() * 1000) / 1000.0);
    }
    n.put("availableProcessors", Runtime.getRuntime().availableProcessors());
    ArrayNode arr = n.putArray("matches");
    for (MatchSession s : matches.all()) {
      arr.add(
          Json.obj()
              .put("id", s.id())
              .put("mode", s.config().mode().wire())
              .put("state", s.state().name())
              .put("tick", s.clock().tick())
              .put("avgLoopMs", Math.round(s.stats().avgLoopMillis() * 1000) / 1000.0)
              .put("maxLoopMs", Math.round(s.stats().maxLoopMillis() * 1000) / 1000.0)
              .put("plays", s.stats().plays())
              .put("kbOut", s.stats().bytesOut() / 1024));
    }
    return n.toString();
  }
}
