package com.anyroyale.server.match;

import com.anyroyale.server.sessions.ClientChannel;
import com.anyroyale.server.util.Json;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** In-memory client used by match tests. */
final class FakeChannel implements ClientChannel {
  final String guestId;
  final String name;
  volatile boolean open = true;
  final List<String> sent = new CopyOnWriteArrayList<>();

  FakeChannel(String guestId, String name) {
    this.guestId = guestId;
    this.name = name;
  }

  @Override
  public String guestId() {
    return guestId;
  }

  @Override
  public String name() {
    return name;
  }

  @Override
  public void send(String json) {
    sent.add(json);
  }

  @Override
  public boolean isOpen() {
    return open;
  }

  List<JsonNode> ofType(String type) {
    List<JsonNode> out = new ArrayList<>();
    for (String s : sent) {
      JsonNode n = Json.parseObject(s);
      if (n != null && type.equals(n.path("type").asText())) {
        out.add(n);
      }
    }
    return out;
  }

  JsonNode last(String type) {
    List<JsonNode> all = ofType(type);
    return all.isEmpty() ? null : all.get(all.size() - 1);
  }
}
