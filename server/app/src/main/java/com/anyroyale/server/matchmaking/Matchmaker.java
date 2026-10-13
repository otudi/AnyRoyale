package com.anyroyale.server.matchmaking;

import com.anyroyale.server.match.MatchConfig.MatchMode;
import com.anyroyale.server.match.MatchManager;
import com.anyroyale.server.match.MatchManager.Contestant;
import com.anyroyale.server.sessions.ClientChannel;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Online 1v1 queue. First come, first served: when a second distinct guest joins, both leave the
 * queue and a match is created. There is deliberately no bot fallback: a player waits until a real
 * opponent arrives (the client shows the waiting state).
 */
public final class Matchmaker {

  private final MatchManager matches;
  private final Map<String, ClientChannel> queue = new LinkedHashMap<>();

  public Matchmaker(MatchManager matches) {
    this.matches = matches;
  }

  /** Adds a guest to the queue; returns the queue size after joining (1 = waiting alone). */
  public synchronized int enqueue(ClientChannel channel) {
    queue.remove(channel.guestId());
    // Drop dead connections so nobody is matched with a closed tab.
    queue.values().removeIf(c -> !c.isOpen());
    Iterator<Map.Entry<String, ClientChannel>> it = queue.entrySet().iterator();
    if (it.hasNext()) {
      Map.Entry<String, ClientChannel> first = it.next();
      it.remove();
      matches.create(
          MatchMode.ONLINE, Contestant.human(first.getValue()), Contestant.human(channel), null);
      return 0;
    }
    queue.put(channel.guestId(), channel);
    return queue.size();
  }

  public synchronized boolean cancel(String guestId) {
    return queue.remove(guestId) != null;
  }

  public synchronized boolean isQueued(String guestId) {
    return queue.containsKey(guestId);
  }

  public synchronized int size() {
    return queue.size();
  }
}
