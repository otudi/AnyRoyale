package com.anyroyale.server.bots;

import java.util.List;

/** Creates bot brains by difficulty name. */
public final class BotFactory {

  public static final List<String> DIFFICULTIES = List.of("easy", "normal", "hard", "expert");

  private BotFactory() {}

  public static BotBrain create(String difficulty, long seed) {
    return new HeuristicBot(BotProfile.of(difficulty), seed);
  }

  public static String displayName(String difficulty) {
    return switch (BotProfile.of(difficulty).name()) {
      case "easy" -> "Training Bot (Easy)";
      case "hard" -> "Training Bot (Hard)";
      case "expert" -> "Training Bot (Expert)";
      default -> "Training Bot (Normal)";
    };
  }
}
