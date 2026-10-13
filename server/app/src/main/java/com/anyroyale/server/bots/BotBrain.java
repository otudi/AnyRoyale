package com.anyroyale.server.bots;

/**
 * A bot's decision maker. Called once per simulation tick from the match thread; returns a card
 * play or null. The returned play goes through exactly the same validation as a human's play
 * (hand slot, elixir, placement), so bots cannot break rules the player has to follow.
 */
public interface BotBrain {

  /** A requested play, in absolute arena game units. */
  record Decision(int handIndex, String cardId, int x, int y) {}

  Decision think(BotView view);

  String difficulty();
}
