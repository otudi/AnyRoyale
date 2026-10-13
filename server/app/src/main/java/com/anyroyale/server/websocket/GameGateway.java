package com.anyroyale.server.websocket;

import com.anyroyale.server.bots.BotFactory;
import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.match.MatchManager;
import com.anyroyale.server.match.MatchManager.Contestant;
import com.anyroyale.server.match.MatchSession;
import com.anyroyale.server.matchmaking.Matchmaker;
import com.anyroyale.server.rooms.PrivateRoomManager;
import com.anyroyale.server.sessions.ClientChannel;
import com.anyroyale.server.sessions.GuestSessionManager;
import com.anyroyale.server.sessions.GuestSessionManager.GuestIdentity;
import com.anyroyale.server.util.Json;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsContext;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * WebSocket entry point: authenticates guests, routes lobby commands (queue, rooms, bot matches)
 * and forwards battle commands to the guest's match. See shared/protocols/PROTOCOL.md.
 */
public final class GameGateway {

  private static final Logger log = LoggerFactory.getLogger(GameGateway.class);
  public static final int PROTOCOL_VERSION = 1;

  private final GuestSessionManager guests;
  private final MatchManager matches;
  private final Matchmaker matchmaker;
  private final PrivateRoomManager rooms;
  private final Map<String, WsClient> bySession = new ConcurrentHashMap<>();
  private final Map<String, WsClient> byGuest = new ConcurrentHashMap<>();
  private final AtomicLong connectionsTotal = new AtomicLong();

  public GameGateway(
      GuestSessionManager guests,
      MatchManager matches,
      Matchmaker matchmaker,
      PrivateRoomManager rooms) {
    this.guests = guests;
    this.matches = matches;
    this.matchmaker = matchmaker;
    this.rooms = rooms;
    matches.setChannelLookup(byGuest::get);
  }

  public void configure(WsConfig ws) {
    ws.onConnect(
        ctx -> {
          ctx.session.setIdleTimeout(java.time.Duration.ofSeconds(60));
          ctx.session.setMaxTextMessageSize(8 * 1024);
          ctx.enableAutomaticPings(15, java.util.concurrent.TimeUnit.SECONDS);
          WsClient client = new WsClient(ctx);
          bySession.put(ctx.sessionId(), client);
          connectionsTotal.incrementAndGet();
        });
    ws.onMessage(
        ctx -> {
          WsClient client = bySession.get(ctx.sessionId());
          if (client != null) {
            handle(client, ctx.message());
          }
        });
    ws.onClose(ctx -> onClose(ctx));
    ws.onError(ctx -> log.debug("WebSocket error: {}", String.valueOf(ctx.error())));
  }

  private void onClose(WsContext ctx) {
    WsClient client = bySession.remove(ctx.sessionId());
    if (client == null) {
      return;
    }
    client.markClosed();
    String guestId = client.guestId;
    if (guestId == null) {
      return;
    }
    byGuest.remove(guestId, client);
    matchmaker.cancel(guestId);
    rooms.cancelHostedBy(guestId);
    MatchSession session = matches.activeMatchOf(guestId);
    if (session != null) {
      session.detach(client);
    }
  }

  void handle(WsClient client, String text) {
    if (!client.allowInbound(System.currentTimeMillis())) {
      error(client, "rateLimited", "Too many messages.");
      return;
    }
    JsonNode msg = Json.parseObject(text);
    if (msg == null) {
      error(client, "badMessage", "Malformed message.");
      return;
    }
    String type = Json.text(msg, "type", "");
    if (!client.authenticated && !type.equals("hello") && !type.equals("ping")) {
      error(client, "notAuthenticated", "Send hello first.");
      return;
    }
    try {
      switch (type) {
        case "hello" -> hello(client, msg);
        case "ping" ->
            client.send(
                Json.obj()
                    .put("type", "pong")
                    .put("t", Json.longValue(msg, "t", 0))
                    .put("serverTime", System.currentTimeMillis())
                    .toString());
        case "setName" -> setName(client, msg);
        case "queue" -> queue(client);
        case "cancelQueue" -> {
          matchmaker.cancel(client.guestId);
          client.send(Json.obj().put("type", "queueCancelled").toString());
        }
        case "createRoom" -> createRoom(client);
        case "joinRoom" -> joinRoom(client, msg);
        case "cancelRoom" -> {
          rooms.cancelHostedBy(client.guestId);
          client.send(Json.obj().put("type", "roomCancelled").toString());
        }
        case "startBot" -> startBot(client, msg);
        case "ready", "play", "leave", "rematch" -> battleCommand(client, type, msg);
        default -> error(client, "unknownType", "Unknown message type.");
      }
    } catch (RuntimeException e) {
      log.error("Error handling {} from {}", type, client.guestId, e);
      error(client, "serverError", "Server error.");
    }
  }

  private void hello(WsClient client, JsonNode msg) {
    String guestId = Json.text(msg, "guestId", null);
    String token = Json.text(msg, "token", null);
    boolean valid = guests.verify(guestId, token);
    if (!valid) {
      GuestIdentity id = guests.issue();
      guestId = id.guestId();
      token = id.token();
    }
    String name = GuestSessionManager.sanitizeName(Json.text(msg, "name", null));
    if (name == null) {
      name = guests.randomName();
    }
    client.guestId = guestId;
    client.name = name;
    client.authenticated = true;
    WsClient previous = byGuest.put(guestId, client);
    if (previous != null && previous != client && previous.isOpen()) {
      // Same guest opened a second tab: the newest connection wins, the old one is told why.
      previous.send(Json.obj().put("type", "replaced").toString());
      matchmaker.cancel(guestId);
    }
    ObjectNode welcome = Json.obj().put("type", "welcome");
    welcome.put("guestId", guestId);
    welcome.put("token", token);
    welcome.put("name", name);
    welcome.put("newIdentity", !valid);
    welcome.put("protocol", PROTOCOL_VERSION);
    welcome.put("serverTime", System.currentTimeMillis());
    MatchSession active = matches.activeMatchOf(guestId);
    welcome.put("activeMatch", active != null ? active.id() : null);
    client.send(welcome.toString());
    if (active != null) {
      active.attach(client); // resume: sends matchStart{resume:true} and a fresh snapshot
    }
  }

  private void setName(WsClient client, JsonNode msg) {
    String name = GuestSessionManager.sanitizeName(Json.text(msg, "name", null));
    if (name == null) {
      error(client, "badName", "Names need 2-16 letters or digits.");
      return;
    }
    client.name = name;
    client.send(Json.obj().put("type", "nameSet").put("name", name).toString());
  }

  private boolean busy(WsClient client) {
    MatchSession active = matches.activeMatchOf(client.guestId);
    if (active != null
        && (active.state() == MatchSession.State.ENDED
            || active.state() == MatchSession.State.CLOSED)) {
      // Starting something new from the result screen implicitly leaves the finished match.
      active.leave(client.guestId);
      matches.releaseGuest(client.guestId, active.id());
      active = null;
    }
    if (active != null) {
      error(client, "inMatch", "You are already in a match.");
      return true;
    }
    if (matches.atCapacity()) {
      error(client, "serverFull", "The server is full. Please try again shortly.");
      return true;
    }
    return false;
  }

  private void queue(WsClient client) {
    if (busy(client)) {
      return;
    }
    rooms.cancelHostedBy(client.guestId);
    int size = matchmaker.enqueue(client);
    if (size > 0) {
      client.send(Json.obj().put("type", "queued").put("waiting", size).toString());
    }
  }

  private void createRoom(WsClient client) {
    if (busy(client)) {
      return;
    }
    matchmaker.cancel(client.guestId);
    String code = rooms.create(client);
    client.send(Json.obj().put("type", "roomCreated").put("code", code).toString());
  }

  private void joinRoom(WsClient client, JsonNode msg) {
    if (busy(client)) {
      return;
    }
    matchmaker.cancel(client.guestId);
    switch (rooms.join(Json.text(msg, "code", ""), client)) {
      case STARTED -> {}
      case NOT_FOUND -> error(client, "roomNotFound", "Room not found or expired.");
      case OWN_ROOM -> error(client, "ownRoom", "Share the code with a friend to start.");
      case SERVER_FULL -> error(client, "serverFull", "The server is full.");
    }
  }

  private void startBot(WsClient client, JsonNode msg) {
    if (busy(client)) {
      return;
    }
    matchmaker.cancel(client.guestId);
    rooms.cancelHostedBy(client.guestId);
    String difficulty = Json.text(msg, "difficulty", "normal").toLowerCase();
    if (!BotFactory.DIFFICULTIES.contains(difficulty)) {
      difficulty = "normal";
    }
    Long seed = null;
    String seedText = Json.text(msg, "seed", null);
    if (seedText != null) {
      try {
        seed = Long.parseLong(seedText); // "replay with the same deck"
      } catch (NumberFormatException ignored) {
        // fresh seed
      }
    }
    matches.create(
        MatchMode.BOT,
        Contestant.human(client),
        Contestant.bot(
            BotFactory.create(difficulty, System.nanoTime()), BotFactory.displayName(difficulty)),
        seed);
  }

  private void battleCommand(WsClient client, String type, JsonNode msg) {
    MatchSession session = matches.activeMatchOf(client.guestId);
    String matchId = Json.text(msg, "matchId", "");
    if (session == null || !session.id().equals(matchId)) {
      if (!type.equals("leave")) {
        error(client, "noMatch", "That match is not active.");
      }
      return;
    }
    switch (type) {
      case "ready" -> session.ready(client.guestId);
      case "leave" -> session.leave(client.guestId);
      case "rematch" -> session.requestRematch(client.guestId, Json.bool(msg, "sameDeck", false));
      case "play" ->
          session.play(
              client.guestId,
              Json.longValue(msg, "seq", -1),
              Json.intValue(msg, "slot", -1),
              Json.text(msg, "card", ""),
              Json.intValue(msg, "x", -1),
              Json.intValue(msg, "y", -1));
      default -> {}
    }
  }

  private static void error(ClientChannel client, String code, String message) {
    client.send(Json.obj().put("type", "error").put("code", code).put("message", message).toString());
  }

  public int connections() {
    return bySession.size();
  }

  public long connectionsTotal() {
    return connectionsTotal.get();
  }

  public void closeAll() {
    for (WsClient c : bySession.values()) {
      c.close(1012, "Server restarting");
    }
  }
}
