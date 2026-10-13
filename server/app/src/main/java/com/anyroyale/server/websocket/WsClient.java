package com.anyroyale.server.websocket;

import com.anyroyale.server.sessions.ClientChannel;
import io.javalin.websocket.WsContext;
import java.util.ArrayDeque;
import java.util.Deque;
import org.eclipse.jetty.websocket.api.Callback;
import org.eclipse.jetty.websocket.api.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * One browser WebSocket connection.
 *
 * <p>Outbound frames go through a per-connection queue with at most one write in flight, so frames
 * from the match thread and the network thread never interleave or race. A client that stops
 * reading (backgrounded tab on a bad network) cannot make the server buffer without bound: stale
 * snapshots are dropped first, and the connection is closed if even control messages pile up. A
 * dropped snapshot is harmless because every snapshot carries the full state.
 */
final class WsClient implements ClientChannel {

  private static final Logger log = LoggerFactory.getLogger(WsClient.class);
  private static final int MAX_QUEUED = 256;

  private final WsContext ctx;
  private final Session session;
  private final Deque<String> queue = new ArrayDeque<>();
  private boolean writing;
  private volatile boolean open = true;

  volatile String guestId;
  volatile String name;
  volatile boolean authenticated;

  // Inbound rate limiting (messages per second window)
  private long windowStartMs;
  private int windowCount;

  WsClient(WsContext ctx) {
    this.ctx = ctx;
    this.session = ctx.session;
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
  public boolean isOpen() {
    return open && session.isOpen();
  }

  void markClosed() {
    open = false;
    synchronized (this) {
      queue.clear();
    }
  }

  String sessionId() {
    return ctx.sessionId();
  }

  @Override
  public void send(String json) {
    if (!isOpen()) {
      return;
    }
    boolean overflow = false;
    synchronized (this) {
      if (queue.size() >= MAX_QUEUED) {
        // Drop queued snapshots, keep control messages.
        queue.removeIf(m -> m.startsWith("{\"type\":\"snap\""));
        if (queue.size() >= MAX_QUEUED) {
          overflow = true;
        }
      }
      if (!overflow) {
        queue.addLast(json);
        if (writing) {
          return;
        }
        writing = true;
      }
    }
    if (overflow) {
      log.warn("Closing slow client {} ({}): outbound queue full", guestId, sessionId());
      close(1013, "Client too slow");
      return;
    }
    writeNext();
  }

  private void writeNext() {
    String next;
    synchronized (this) {
      next = queue.pollFirst();
      if (next == null) {
        writing = false;
        return;
      }
    }
    try {
      session.sendText(next, Callback.from(this::writeNext, this::onWriteFailed));
    } catch (RuntimeException e) {
      onWriteFailed(e);
    }
  }

  private void onWriteFailed(Throwable t) {
    log.debug("Write failed for {}: {}", guestId, t.toString());
    markClosed();
    synchronized (this) {
      writing = false;
    }
  }

  void close(int code, String reason) {
    markClosed();
    try {
      ctx.closeSession(code, reason);
    } catch (RuntimeException ignored) {
      // already closed
    }
  }

  /** Returns false if the client exceeded the inbound message budget for this second. */
  boolean allowInbound(long nowMs) {
    if (nowMs - windowStartMs >= 1000) {
      windowStartMs = nowMs;
      windowCount = 0;
    }
    return ++windowCount <= 40;
  }
}
