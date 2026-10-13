package com.anyroyale.server.sessions;

/**
 * Outbound side of one browser connection. Implemented over WebSocket in production and by
 * in-memory fakes in tests, so match logic never depends on the transport.
 */
public interface ClientChannel {

  String guestId();

  String name();

  /** Sends a JSON text frame. Must be safe to call from any thread; must never block for long. */
  void send(String json);

  boolean isOpen();
}
