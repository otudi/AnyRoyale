package org.crforge.core.util;

/**
 * Entity and projectile id allocation.
 *
 * <p>AnyRoyale modification (not in upstream crforge): upstream used two global static counters
 * that {@code GameState.reset()} rewound to 1. That is safe for one simulation per JVM but not for a
 * server running many matches concurrently, where one match starting would rewind the ids of
 * another and create duplicate ids. Each {@code GameEngine} now owns an {@link Allocator} and binds
 * it to the ticking thread; code running without a bound allocator (unit tests, tools) falls back
 * to a process-wide allocator, which keeps the upstream behaviour for those callers.
 */
public final class EntityIds {

  /** Per-simulation id counters. Not thread-safe: a simulation is ticked by one thread at a time. */
  public static final class Allocator {
    private long nextEntityId = 1;
    private long nextProjectileId = 1;

    long nextEntity() {
      return nextEntityId++;
    }

    long nextProjectile() {
      return nextProjectileId++;
    }

    void resetEntities() {
      nextEntityId = 1;
    }

    void resetProjectiles() {
      nextProjectileId = 1;
    }
  }

  private static final Allocator FALLBACK = new Allocator();
  private static final ThreadLocal<Allocator> CURRENT = new ThreadLocal<>();

  private EntityIds() {}

  /** Binds {@code allocator} to the current thread and returns the previously bound one. */
  public static Allocator bind(Allocator allocator) {
    Allocator previous = CURRENT.get();
    CURRENT.set(allocator);
    return previous;
  }

  /** Restores the allocator returned by {@link #bind}. */
  public static void restore(Allocator previous) {
    if (previous == null) {
      CURRENT.remove();
    } else {
      CURRENT.set(previous);
    }
  }

  public static long nextEntityId() {
    Allocator a = CURRENT.get();
    if (a != null) {
      return a.nextEntity();
    }
    synchronized (FALLBACK) {
      return FALLBACK.nextEntity();
    }
  }

  public static long nextProjectileId() {
    Allocator a = CURRENT.get();
    if (a != null) {
      return a.nextProjectile();
    }
    synchronized (FALLBACK) {
      return FALLBACK.nextProjectile();
    }
  }

  public static void resetEntityIds() {
    Allocator a = CURRENT.get();
    if (a != null) {
      a.resetEntities();
      return;
    }
    synchronized (FALLBACK) {
      FALLBACK.resetEntities();
    }
  }

  public static void resetProjectileIds() {
    Allocator a = CURRENT.get();
    if (a != null) {
      a.resetProjectiles();
      return;
    }
    synchronized (FALLBACK) {
      FALLBACK.resetProjectiles();
    }
  }
}
