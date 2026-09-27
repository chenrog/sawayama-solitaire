import { describe, expect, it } from "vitest";
import { applyAction, cardLabel, createDeck, createGame, findAutoPlayAction, isMovableRun, type Card, type GameState } from "./engine";

const card = (suit: Card["suit"], rank: Card["rank"]): Card => ({ id: `${suit}-${rank}`, suit, rank });
const baseState = (): GameState => ({ tableau: Array.from({ length: 7 }, () => []), stock: [], waste: [], foundations: { diamonds: [], clubs: [], spades: [], hearts: [] }, freeCell: null, won: false });

describe("Sawayama rules engine", () => {
  it("deals all 52 unique cards into tableau and stock", () => {
    const game = createGame(() => 0.5);
    expect(game.tableau.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect([...game.tableau.flat(), ...game.stock].map((item) => item.id)).toHaveLength(52);
    expect(new Set(createDeck().map((item) => item.id)).size).toBe(52);
  });

  it("uses compact rank and suit labels", () => {
    expect(cardLabel(card("diamonds", 9))).toBe("9♦");
    expect(cardLabel(card("hearts", 10))).toBe("10♥");
    expect(cardLabel(card("clubs", 11))).toBe("J♣");
  });

  it("accepts only alternating descending tableau runs", () => {
    expect(isMovableRun([card("clubs", 3), card("hearts", 2)])).toBe(true);
    expect(isMovableRun([card("clubs", 3), card("spades", 2)])).toBe(false);
    expect(isMovableRun([card("clubs", 4), card("hearts", 2)])).toBe(false);
  });

  it("moves a valid run onto a compatible card", () => {
    const state = baseState();
    state.tableau[0] = [card("clubs", 3), card("hearts", 2)];
    state.tableau[1] = [card("diamonds", 4)];
    const result = applyAction(state, { type: "moveTableau", pile: 0, startIndex: 0, destination: { type: "tableau", pile: 1 } });
    expect(result.moved).toBe(true);
    expect(result.state.tableau[1].map((item) => item.rank)).toEqual([4, 3, 2]);
  });

  it("auto-plays exposed aces, 2s, and safe higher cards only", () => {
    const state = baseState();
    state.tableau[0] = [card("hearts", 1)];
    expect(findAutoPlayAction(state)).toMatchObject({ type: "moveTableau", pile: 0, destination: { type: "foundation", suit: "hearts" } });

    state.tableau[0] = [card("hearts", 2)];
    state.foundations.hearts = [card("hearts", 1)];
    expect(findAutoPlayAction(state)).toMatchObject({ type: "moveTableau", pile: 0, destination: { type: "foundation", suit: "hearts" } });

    state.tableau[0] = [card("clubs", 3)];
    state.foundations.clubs = [card("clubs", 1), card("clubs", 2)];
    expect(findAutoPlayAction(state)).toBeNull();

    state.foundations.hearts = [card("hearts", 1), card("hearts", 2)];
    state.foundations.diamonds = [card("diamonds", 1), card("diamonds", 2)];
    expect(findAutoPlayAction(state)).toMatchObject({ type: "moveTableau", pile: 0, destination: { type: "foundation", suit: "clubs" } });
  });

  it("allows a single card in the free cell only after stock runs out", () => {
    const state = baseState(); state.stock = [card("spades", 7)]; state.tableau[0] = [card("hearts", 2)];
    expect(applyAction(state, { type: "moveTableau", pile: 0, startIndex: 0, destination: { type: "freeCell" } }).moved).toBe(false);
    state.stock = [];
    expect(applyAction(state, { type: "moveTableau", pile: 0, startIndex: 0, destination: { type: "freeCell" } }).moved).toBe(true);
  });

  it("moves the top waste card into the free cell after stock runs out", () => {
    const state = baseState();
    state.waste = [card("clubs", 8)];
    const result = applyAction(state, { type: "moveWaste", destination: { type: "freeCell" } });
    expect(result.moved).toBe(true);
    expect(result.state.freeCell).toEqual(card("clubs", 8));
    expect(result.state.waste).toEqual([]);
  });
});
