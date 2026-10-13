package com.anyroyale.server.bots;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.crforge.core.card.Card;
import org.crforge.core.engine.GameState;
import org.crforge.core.entity.base.Entity;
import org.crforge.core.entity.structure.Tower;
import org.crforge.core.entity.unit.Troop;
import org.crforge.core.match.Match;
import org.crforge.core.player.Player;
import org.crforge.core.player.Team;
import org.crforge.core.player.dto.PlayerActionDTO;

/**
 * What a bot is allowed to see: its own hand and elixir, every entity a player could see on screen
 * (invisible enemy units are filtered out), the public log of cards the opponent has played, the
 * shared deck (known to both players in AnyRoyale), and the match clock. It never exposes the
 * opponent's hand or elixir.
 */
public final class BotView {

  /** A card the opponent was seen playing. */
  public record SeenPlay(int tick, String cardId, int x, int y) {}

  private final Match match;
  private final GameState state;
  private final Player self;
  private final int tick;
  private final boolean overtime;
  private final int elixirMultiplier;
  private final float timeLeftSeconds;
  private final List<SeenPlay> opponentPlays;
  private final List<String> deck;
  private List<Entity> visible;

  public BotView(
      Match match,
      GameState state,
      Player self,
      int tick,
      boolean overtime,
      int elixirMultiplier,
      float timeLeftSeconds,
      List<SeenPlay> opponentPlays,
      List<String> deck) {
    this.match = match;
    this.state = state;
    this.self = self;
    this.tick = tick;
    this.overtime = overtime;
    this.elixirMultiplier = elixirMultiplier;
    this.timeLeftSeconds = timeLeftSeconds;
    this.opponentPlays = Collections.unmodifiableList(opponentPlays);
    this.deck = deck;
  }

  public Team team() {
    return self.getTeam();
  }

  public int tick() {
    return tick;
  }

  public float elixir() {
    return self.getElixir().getCurrent();
  }

  public Card handCard(int index) {
    return self.getHand().getCard(index);
  }

  public Card nextCard() {
    return self.getHand().getNextCard();
  }

  public Card lastPlayedCard() {
    return self.getLastPlayedCard();
  }

  public boolean overtime() {
    return overtime;
  }

  public int elixirMultiplier() {
    return elixirMultiplier;
  }

  public float timeLeftSeconds() {
    return timeLeftSeconds;
  }

  public List<SeenPlay> opponentPlays() {
    return opponentPlays;
  }

  public List<String> deck() {
    return deck;
  }

  /** Entities visible to this bot (own units plus enemy units that are not invisible). */
  public List<Entity> visibleEntities() {
    if (visible == null) {
      List<Entity> out = new ArrayList<>();
      for (Entity e : state.getAliveEntities()) {
        if (e.getTeam() != self.getTeam() && e instanceof Troop t && t.isInvisible()) {
          continue;
        }
        out.add(e);
      }
      visible = out;
    }
    return visible;
  }

  public List<Tower> towers(Team team) {
    return state.getTowers().get(team);
  }

  public int crowns(Team team) {
    return state.getCrownCount(team);
  }

  /** True if the engine would accept this play right now (hand slot, placement rules). */
  public boolean isValidPlacement(int handIndex, int x, int y) {
    return match.validateAction(self, PlayerActionDTO.play(handIndex, x, y));
  }
}
