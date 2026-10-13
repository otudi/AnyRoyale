package com.anyroyale.server.rooms;

import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.match.MatchManager;
import com.anyroyale.server.match.MatchManager.Contestant;
import com.anyroyale.server.sessions.ClientChannel;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;
import java.util.function.LongSupplier;

/**
 * Friend challenges: a host creates a room and shares a short code (or an invite link containing
 * it); the first other guest to join starts the match. A room holds exactly two seats, so a third
 * player can never join: the room is removed the moment the second player arrives.
 *
 * <p>A room belongs to the host's guest id, not to one connection, so it survives the host's
 * network dropping for up to {@link #HOST_AWAY_MS}: the join uses whatever connection the host has
 * then.
 */
public final class PrivateRoomManager {

  /** No 0/O/1/I/L to avoid misreading when codes are typed from a phone screen. */
  private static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  private static final int CODE_LENGTH = 5;
  private static final long ROOM_TTL_MS = 15 * 60 * 1000L;
  static final long HOST_AWAY_MS = 30 * 1000L;

  public enum JoinResult {
    STARTED,
    NOT_FOUND,
    OWN_ROOM,
    SERVER_FULL
  }

  private static final class Room {
    final String code;
    final String hostGuestId;
    final long createdAtMs;
    long hostAwaySinceMs = -1;

    Room(String code, String hostGuestId, long createdAtMs) {
      this.code = code;
      this.hostGuestId = hostGuestId;
      this.createdAtMs = createdAtMs;
    }
  }

  private final MatchManager matches;
  private final LongSupplier clockMs;
  private final SecureRandom random = new SecureRandom();
  private final Map<String, Room> rooms = new HashMap<>();
  private volatile Function<String, ClientChannel> channelLookup = id -> null;

  public PrivateRoomManager(MatchManager matches) {
    this(matches, System::currentTimeMillis);
  }

  PrivateRoomManager(MatchManager matches, LongSupplier clockMs) {
    this.matches = matches;
    this.clockMs = clockMs;
  }

  /** Finds a guest's current connection (set by the WebSocket gateway). */
  public void setChannelLookup(Function<String, ClientChannel> lookup) {
    this.channelLookup = lookup;
  }

  public synchronized String create(ClientChannel host) {
    purge();
    cancelHostedBy(host.guestId());
    String code;
    do {
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < CODE_LENGTH; i++) {
        sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
      }
      code = sb.toString();
    } while (rooms.containsKey(code));
    rooms.put(code, new Room(code, host.guestId(), clockMs.getAsLong()));
    return code;
  }

  public synchronized JoinResult join(String rawCode, ClientChannel guest) {
    purge();
    String code = rawCode == null ? "" : rawCode.trim().toUpperCase();
    Room room = rooms.get(code);
    if (room == null) {
      return JoinResult.NOT_FOUND;
    }
    if (room.hostGuestId.equals(guest.guestId())) {
      return JoinResult.OWN_ROOM;
    }
    ClientChannel host = channelLookup.apply(room.hostGuestId);
    if (host == null || !host.isOpen()) {
      return JoinResult.NOT_FOUND; // host is reconnecting; the room stays for a little while
    }
    if (matches.atCapacity()) {
      return JoinResult.SERVER_FULL;
    }
    if (matches.activeMatchOf(room.hostGuestId) != null) {
      rooms.remove(code); // the host started something else meanwhile
      return JoinResult.NOT_FOUND;
    }
    rooms.remove(code);
    matches.create(MatchMode.PRIVATE, Contestant.human(host), Contestant.human(guest), null);
    return JoinResult.STARTED;
  }

  public synchronized void cancelHostedBy(String guestId) {
    rooms.values().removeIf(r -> r.hostGuestId.equals(guestId));
  }

  public synchronized int size() {
    return rooms.size();
  }

  private void purge() {
    long now = clockMs.getAsLong();
    rooms
        .values()
        .removeIf(
            r -> {
              if (now - r.createdAtMs > ROOM_TTL_MS) {
                return true;
              }
              ClientChannel host = channelLookup.apply(r.hostGuestId);
              if (host != null && host.isOpen()) {
                r.hostAwaySinceMs = -1;
                return false;
              }
              if (r.hostAwaySinceMs < 0) {
                r.hostAwaySinceMs = now;
              }
              return now - r.hostAwaySinceMs > HOST_AWAY_MS;
            });
  }
}
