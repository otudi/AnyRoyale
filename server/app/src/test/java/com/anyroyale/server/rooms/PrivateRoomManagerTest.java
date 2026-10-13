package com.anyroyale.server.rooms;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.ServerConfig;
import com.anyroyale.server.match.MatchManager;
import com.anyroyale.server.replay.ReplayStore;
import com.anyroyale.server.sessions.ClientChannel;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class PrivateRoomManagerTest {

  private static final class Ch implements ClientChannel {
    final String id;
    boolean open = true;

    Ch(String id) {
      this.id = id;
    }

    @Override
    public String guestId() {
      return id;
    }

    @Override
    public String name() {
      return id;
    }

    @Override
    public void send(String json) {}

    @Override
    public boolean isOpen() {
      return open;
    }
  }

  private final AtomicLong now = new AtomicLong(1_000_000);
  private final Map<String, ClientChannel> current = new HashMap<>();
  private final MatchManager matches =
      new MatchManager(ServerConfig.forTests(20), new ReplayStore(null));
  private final PrivateRoomManager rooms = new PrivateRoomManager(matches, now::get);

  {
    rooms.setChannelLookup(current::get);
  }

  @AfterEach
  void tearDown() {
    matches.shutdown();
  }

  @Test
  void roomSurvivesTheHostReconnecting() {
    Ch host = new Ch("g_host");
    current.put(host.id, host);
    String code = rooms.create(host);
    host.open = false;
    current.remove(host.id);
    Ch guest = new Ch("g_guest");
    assertThat(rooms.join(code, guest)).isEqualTo(PrivateRoomManager.JoinResult.NOT_FOUND);
    now.addAndGet(5_000);
    Ch host2 = new Ch("g_host");
    current.put(host2.id, host2);
    assertThat(rooms.join(code, guest)).isEqualTo(PrivateRoomManager.JoinResult.STARTED);
    assertThat(matches.activeMatchOf("g_host")).isNotNull();
  }

  @Test
  void roomOfAHostWhoNeverComesBackExpires() {
    Ch host = new Ch("g_host");
    current.put(host.id, host);
    String code = rooms.create(host);
    current.remove(host.id);
    Ch guest = new Ch("g_guest");
    rooms.join(code, guest);
    now.addAndGet(PrivateRoomManager.HOST_AWAY_MS + 1_000);
    rooms.join(code, guest);
    assertThat(rooms.size()).isZero();
  }
}
