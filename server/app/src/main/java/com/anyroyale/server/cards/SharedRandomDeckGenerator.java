package com.anyroyale.server.cards;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import org.crforge.core.card.Card;

/**
 * Generates the single deck that both players use in an AnyRoyale match.
 *
 * <p>The deck is a pure function of the server-generated seed: the same seed always yields the same
 * eight cards in the same order, so the seed stored in the match record is enough to reproduce it.
 * Card selection is uniform rejection sampling over {@link CardPool}: a random eight-card draw is
 * kept only if it passes {@link #validate}. The rules only reject decks that cannot answer whole
 * classes of threats (no air defence, no win condition, ...); they do not steer towards particular
 * cards, so the variety of the pool is preserved.
 */
public final class SharedRandomDeckGenerator {

  public static final int DECK_SIZE = 8;
  private static final int MAX_ATTEMPTS = 50_000;

  /** A generated deck: card ids in deck order, plus the seed it came from. */
  public record DeckSpec(long seed, List<String> cardIds, int attempts) {
    public List<Card> cards() {
      return cardIds.stream().map(CardPool::get).toList();
    }

    public double averageCost() {
      return cards().stream().mapToInt(Card::getCost).average().orElse(0);
    }
  }

  private final List<Card> pool;

  public SharedRandomDeckGenerator() {
    this(CardPool.all());
  }

  public SharedRandomDeckGenerator(List<Card> pool) {
    if (pool.size() < DECK_SIZE) {
      throw new IllegalArgumentException("Card pool too small: " + pool.size());
    }
    this.pool = List.copyOf(pool);
  }

  public DeckSpec generate(long seed) {
    Random random = new Random(seed);
    List<Card> shuffled = new ArrayList<>(pool);
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      Collections.shuffle(shuffled, random);
      List<Card> candidate = shuffled.subList(0, DECK_SIZE);
      if (validate(candidate).isEmpty()) {
        return new DeckSpec(seed, candidate.stream().map(Card::getId).toList(), attempt);
      }
    }
    // Practically unreachable with the current pool (about 1 in 10 random draws passes), but keep
    // the server alive: fall back to the last draw and report it.
    return new DeckSpec(
        seed, shuffled.subList(0, DECK_SIZE).stream().map(Card::getId).toList(), MAX_ATTEMPTS);
  }

  /** Returns the violated rules (empty if the deck is acceptable). */
  public static List<String> validate(List<Card> deck) {
    List<String> problems = new ArrayList<>();
    if (deck.size() != DECK_SIZE) {
      problems.add("deck must have 8 cards");
      return problems;
    }
    if (deck.stream().map(Card::getId).distinct().count() != DECK_SIZE) {
      problems.add("duplicate cards");
    }
    List<CardTraits> traits = deck.stream().map(CardTraits::of).toList();
    long spells = traits.stream().filter(CardTraits::spell).count();
    long buildings = traits.stream().filter(CardTraits::building).count();
    long antiAir = traits.stream().filter(CardTraits::antiAirUnit).count();
    long splash = traits.stream().filter(CardTraits::splash).count();
    long winCons = traits.stream().filter(CardTraits::winCondition).count();
    long cheap = traits.stream().filter(t -> t.cost() <= 3).count();
    long heavy = traits.stream().filter(t -> t.cost() >= 7).count();
    long damagingSpells = traits.stream().filter(CardTraits::damagingSpell).count();
    double avg = traits.stream().mapToInt(CardTraits::cost).average().orElse(0);

    if (spells < 1 || spells > 3) {
      problems.add("needs 1-3 spells, has " + spells);
    }
    if (damagingSpells < 1) {
      problems.add("needs a damaging spell");
    }
    if (buildings > 2) {
      problems.add("at most 2 buildings, has " + buildings);
    }
    if (antiAir < 2) {
      problems.add("needs 2 troops/buildings that hit air, has " + antiAir);
    }
    if (splash < 1) {
      problems.add("needs splash damage");
    }
    if (winCons < 1) {
      problems.add("needs a win condition");
    }
    if (cheap < 2) {
      problems.add("needs 2 cards costing 3 or less, has " + cheap);
    }
    if (heavy > 2) {
      problems.add("at most 2 cards costing 7+, has " + heavy);
    }
    if (avg < 2.6 || avg > 4.6) {
      problems.add(String.format("average elixir %.2f outside 2.6-4.6", avg));
    }
    return problems;
  }
}
