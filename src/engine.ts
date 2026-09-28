export const SUITS = ["diamonds", "clubs", "spades", "hearts"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type Color = "red" | "black";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface GameState {
  tableau: Card[][];
  stock: Card[];
  waste: Card[];
  foundations: Record<Suit, Card[]>;
  freeCell: Card | null;
  won: boolean;
}

export type Destination =
  | { type: "tableau"; pile: number }
  | { type: "foundation"; suit: Suit }
  | { type: "freeCell" };

export type GameAction =
  | { type: "deal" }
  | { type: "moveTableau"; pile: number; startIndex: number; destination: Destination }
  | { type: "moveWaste"; destination: Destination }
  | { type: "moveFreeCell"; destination: Exclude<Destination, { type: "freeCell" }> };

export interface MoveResult {
  state: GameState;
  moved: boolean;
  reason?: string;
}

export function cardColor(card: Card): Color {
  return card.suit === "diamonds" || card.suit === "hearts" ? "red" : "black";
}

export function rankLabel(card: Card): string {
  return ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card.rank];
}

export function cardLabel(card: Card): string {
  const symbol: Record<Suit, string> = { diamonds: "♦", clubs: "♣", spades: "♠", hearts: "♥" };
  return `${rankLabel(card)}${symbol[card.suit]}`;
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    Array.from({ length: 13 }, (_, index) => ({
      id: `${suit}-${index + 1}`,
      suit,
      rank: (index + 1) as Rank,
    })),
  );
}

export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createGame(random = Math.random): GameState {
  const deck = shuffle(createDeck(), random);
  const tableau: Card[][] = [];
  let cursor = 0;
  for (let pileSize = 1; pileSize <= 7; pileSize += 1) {
    tableau.push(deck.slice(cursor, cursor + pileSize));
    cursor += pileSize;
  }
  return {
    tableau,
    stock: deck.slice(cursor),
    waste: [],
    foundations: emptyFoundations(),
    freeCell: null,
    won: false,
  };
}

export function isMovableRun(cards: readonly Card[]): boolean {
  return cards.every((card, index) => {
    if (index === cards.length - 1) return true;
    const above = cards[index + 1];
    return card.rank === above.rank + 1 && cardColor(card) !== cardColor(above);
  });
}

export function canPlaceOnTableau(movingBottom: Card, targetPile: readonly Card[]): boolean {
  const target = targetPile.at(-1);
  return !target || (target.rank === movingBottom.rank + 1 && cardColor(target) !== cardColor(movingBottom));
}

export function canPlaceOnFoundation(card: Card, foundation: readonly Card[]): boolean {
  const top = foundation.at(-1);
  return card.rank === (top ? top.rank + 1 : 1) && (!top || card.suit === top.suit);
}

export function findAutoPlayAction(state: GameState): Exclude<GameAction, { type: "deal" }> | null {
  for (let pile = 0; pile < state.tableau.length; pile += 1) {
    const card = state.tableau[pile].at(-1);
    if (card && isSafeAutoFoundationCard(state, card)) {
      return { type: "moveTableau", pile, startIndex: state.tableau[pile].length - 1, destination: { type: "foundation", suit: card.suit } };
    }
  }
  const waste = state.waste.at(-1);
  if (waste && isSafeAutoFoundationCard(state, waste)) return { type: "moveWaste", destination: { type: "foundation", suit: waste.suit } };
  if (state.freeCell && isSafeAutoFoundationCard(state, state.freeCell)) {
    return { type: "moveFreeCell", destination: { type: "foundation", suit: state.freeCell.suit } };
  }
  return null;
}

export function applyAction(state: GameState, action: GameAction): MoveResult {
  if (state.won) return failed(state, "The game is already won.");
  if (action.type === "deal") return deal(state);
  if (action.type === "moveTableau") return moveTableau(state, action);
  if (action.type === "moveWaste") return moveSingle(state, state.waste.at(-1), "waste", action.destination);
  return moveSingle(state, state.freeCell ?? undefined, "freeCell", action.destination);
}

function deal(state: GameState): MoveResult {
  if (state.stock.length === 0) return failed(state, "The stock is empty.");
  const dealt = state.stock.slice(0, 3);
  return succeeded({ ...state, stock: state.stock.slice(dealt.length), waste: [...state.waste, ...dealt] });
}

function moveTableau(
  state: GameState,
  action: Extract<GameAction, { type: "moveTableau" }>,
): MoveResult {
  const source = state.tableau[action.pile];
  if (!source || action.startIndex < 0 || action.startIndex >= source.length) return failed(state, "Choose a card in a tableau pile.");
  const cards = source.slice(action.startIndex);
  if (!isMovableRun(cards)) return failed(state, "That card is not the start of a valid alternating run.");
  if (action.destination.type === "foundation" && cards.length !== 1) return failed(state, "Only one card can move to a foundation.");
  if (action.destination.type === "freeCell" && cards.length !== 1) return failed(state, "Only one card can move to the free cell.");
  if (!canMoveToDestination(state, cards[0], action.destination, action.pile)) return failed(state, "That destination does not accept this card.");

  const tableau = state.tableau.map((pile, index) => (index === action.pile ? pile.slice(0, action.startIndex) : [...pile]));
  return succeeded(addToDestination({ ...state, tableau }, cards, action.destination));
}

function moveSingle(state: GameState, card: Card | undefined, source: "waste" | "freeCell", destination: Destination): MoveResult {
  if (!card) return failed(state, `There is no card in the ${source}.`);
  if (!canMoveToDestination(state, card, destination)) return failed(state, "That destination does not accept this card.");
  const cleared = source === "waste" ? { ...state, waste: state.waste.slice(0, -1) } : { ...state, freeCell: null };
  return succeeded(addToDestination(cleared, [card], destination));
}

function isSafeAutoFoundationCard(state: GameState, card: Card): boolean {
  if (!canPlaceOnFoundation(card, state.foundations[card.suit])) return false;
  if (card.rank <= 2) return true;
  const isRed = cardColor(card) === "red";
  return SUITS
    .filter((suit) => (suit === "diamonds" || suit === "hearts") !== isRed)
    .every((suit) => (state.foundations[suit].at(-1)?.rank ?? 0) >= card.rank - 1);
}

function canMoveToDestination(state: GameState, card: Card, destination: Destination, sourcePile?: number): boolean {
  if (destination.type === "tableau") {
    const target = state.tableau[destination.pile];
    return Boolean(target) && destination.pile !== sourcePile && canPlaceOnTableau(card, target);
  }
  if (destination.type === "foundation") return card.suit === destination.suit && canPlaceOnFoundation(card, state.foundations[destination.suit]);
  return state.stock.length === 0 && state.freeCell === null;
}

function addToDestination(state: GameState, cards: Card[], destination: Destination): GameState {
  if (destination.type === "tableau") {
    const tableau = state.tableau.map((pile, index) => (index === destination.pile ? [...pile, ...cards] : pile));
    return withWinState({ ...state, tableau });
  }
  if (destination.type === "foundation") {
    return withWinState({ ...state, foundations: { ...state.foundations, [destination.suit]: [...state.foundations[destination.suit], cards[0]] } });
  }
  return withWinState({ ...state, freeCell: cards[0] });
}

function emptyFoundations(): Record<Suit, Card[]> {
  return { diamonds: [], clubs: [], spades: [], hearts: [] };
}

function withWinState(state: GameState): GameState {
  return { ...state, won: SUITS.every((suit) => state.foundations[suit].length === 13) };
}

function succeeded(state: GameState): MoveResult {
  return { state, moved: true };
}

function failed(state: GameState, reason: string): MoveResult {
  return { state, moved: false, reason };
}
