package com.anyroyale.server.cards;

import static org.assertj.core.api.Assertions.assertThat;

import com.anyroyale.server.cards.SharedRandomDeckGenerator.DeckSpec;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class SharedRandomDeckGeneratorTest {

  private final SharedRandomDeckGenerator gen = new SharedRandomDeckGenerator();

  @Test
  void sameSeedGivesSameDeckInSameOrder() {
    for (long seed = 0; seed < 50; seed++) {
      DeckSpec a = gen.generate(seed);
      DeckSpec b = new SharedRandomDeckGenerator().generate(seed);
      assertThat(a.cardIds()).containsExactlyElementsOf(b.cardIds());
    }
  }

  @Test
  void differentSeedsGiveDifferentDecks() {
    Set<java.util.List<String>> decks = new HashSet<>();
    for (long seed = 0; seed < 200; seed++) {
      decks.add(gen.generate(seed).cardIds());
    }
    assertThat(decks).hasSizeGreaterThan(195);
  }

  @Test
  void everyGeneratedDeckIsValidAndFromThePool() {
    for (long seed = 1000; seed < 3000; seed++) {
      DeckSpec d = gen.generate(seed);
      assertThat(d.cardIds()).hasSize(8).doesNotHaveDuplicates();
      assertThat(CardPool.ids()).containsAll(d.cardIds());
      assertThat(SharedRandomDeckGenerator.validate(d.cards()))
          .as("deck %s for seed %d", d.cardIds(), seed)
          .isEmpty();
      assertThat(d.attempts()).isLessThan(50_000);
    }
  }

  /** Randomness is a feature: the validity rules must not collapse the pool to a few cards. */
  @Test
  void deckRulesKeepTheWholePoolInRotation() {
    Map<String, Integer> appearances = new HashMap<>();
    int decks = 4000;
    for (long seed = 0; seed < decks; seed++) {
      for (String id : gen.generate(seed * 7919).cardIds()) {
        appearances.merge(id, 1, Integer::sum);
      }
    }
    assertThat(appearances.keySet()).as("cards that ever appear").hasSize(CardPool.size());
    double uniform = decks * 8.0 / CardPool.size();
    for (Map.Entry<String, Integer> e : appearances.entrySet()) {
      assertThat(e.getValue())
          .as("appearances of %s (uniform would be %.0f)", e.getKey(), uniform)
          .isBetween((int) (uniform * 0.25), (int) (uniform * 4));
    }
  }

  @Test
  void validatorRejectsDecksWithoutAirDefenceOrSpells() {
    var noAir =
        java.util.stream.Stream.of(
                "knight", "goblins", "barbarians", "minipekka", "prince", "valkyrie", "hogrider", "zap")
            .map(CardPool::get)
            .toList();
    assertThat(SharedRandomDeckGenerator.validate(noAir)).anyMatch(p -> p.contains("hit air"));
    var noSpell =
        java.util.stream.Stream.of(
                "knight", "archer", "musketeer", "minipekka", "babydragon", "valkyrie", "hogrider", "skeletons")
            .map(CardPool::get)
            .toList();
    assertThat(SharedRandomDeckGenerator.validate(noSpell)).anyMatch(p -> p.contains("spell"));
  }
}
