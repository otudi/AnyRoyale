package com.anyroyale.server.rooms;

import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.match.MatchManager;
import com.anyroyale.server.match.MatchManager.Contestant;
import com.anyroyale.server.sessions.ClientChannel;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;

/**
 * Friend challenges: a host creates a room and shares a short code (or an invite link containing
 * it); the first other guest to join starts the match. A room holds exactly two seats, so a third
 * player can never join: the room is removed the moment the second player arrives.
 */
public final class PrivateRoomManager {

  /** No 0/O/1/I/L to avoid misreading when codes are typed from a phone screen. */
  private static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  private static final int CODE_LENGTH = 5;
  private static final long ROOM_TTL_MS = 15 * 60 * 1000L;

  public enum JoinResult {
    STARTED,
    NOT_FOUND,
    OWN_ROOM,
    SERVER_FULL
  }

  private record Room(String code, ClientChannel host, long createdAtMs) {}

  private final MatchManager matches;
  private final SecureRandom random = new SecureRandom();
  private final Map<String, Room> rooms = new HashMap<>();

  public PrivateRoomManager(MatchManager matches) {
    this.matches = matches;
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
    rooms.put(code, new Room(code, host, System.currentTimeMillis()));
    return code;
  }

  public synchronized JoinResult join(String rawCode, ClientChannel guest) {
    purge();
    String code = rawCode == null ? "" : rawCode.trim().toUpperCase();
    Room room = rooms.get(code);
    if (room == null || !room.host().isOpen()) {
      rooms.remove(code);
      return JoinResult.NOT_FOUND;
    }
    if (room.host().guestId().equals(guest.guestId())) {
      return JoinResult.OWN_ROOM;
    }
    if (matches.atCapacity()) {
      return JoinResult.SERVER_FULL;
    }
    rooms.remove(code);
    matches.create(MatchMode.PRIVATE, Contestant.human(room.host()), Contestant.human(guest), null);
    return JoinResult.STARTED;
  }

  public synchronized void cancelHostedBy(String guestId) {
    rooms.values().removeIf(r -> r.host().guestId().equals(guestId));
  }

  public synchronized int size() {
    return rooms.size();
  }

  private void purge() {
    long now = System.currentTimeMillis();
    rooms.values().removeIf(r -> now - r.createdAtMs() > ROOM_TTL_MS || !r.host().isOpen());
  }
}
