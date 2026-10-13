package com.anyroyale.server.match;

/** Per-match counters, written on the match thread and read (approximately) by /api/stats. */
public final class MatchStats {
  volatile long loops;
  volatile long totalLoopNanos;
  volatile long maxLoopNanos;
  volatile long snapshots;
  volatile long bytesOut;
  volatile long plays;
  volatile long rejected;

  void recordLoop(long nanos) {
    loops++;
    totalLoopNanos += nanos;
    if (nanos > maxLoopNanos) {
      maxLoopNanos = nanos;
    }
  }

  public long loops() {
    return loops;
  }

  public double avgLoopMillis() {
    return loops == 0 ? 0 : totalLoopNanos / 1e6 / loops;
  }

  public double maxLoopMillis() {
    return maxLoopNanos / 1e6;
  }

  public long snapshots() {
    return snapshots;
  }

  public long bytesOut() {
    return bytesOut;
  }

  public long plays() {
    return plays;
  }

  public long rejected() {
    return rejected;
  }
}
