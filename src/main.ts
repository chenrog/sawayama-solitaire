import "./style.css";
import { runDealQueue } from "./deal-queue";
import { undoLatestManualMove, type MoveHistoryEntry } from "./undo-history";
import {
  SUITS,
  applyAction,
  cardColor,
  cardLabel,
  createGame,
  findAutoPlayAction,
  isMovableRun,
  rankLabel,
  type Card,
  type Destination,
  type GameAction,
  type GameState,
  type Suit,
} from "./engine";

type Selection =
  | { source: "tableau"; pile: number; startIndex: number; cards: Card[] }
  | { source: "waste"; cards: Card[] }
  | { source: "freeCell"; cards: Card[] };
type CardSource =
  | { source: "tableau"; pile: number; startIndex: number }
  | { source: "waste" }
  | { source: "freeCell" };

let state = createGame();
let selected: Selection | null = null;
let returningSelection: Selection | null = null;
let returnGeneration = 0;
let message = "Select a card or a valid run.";
let dragGeneration = 0;
let dragGrabOffset = { x: 0, y: 0 };
let dragOrigin = { x: 0, y: 0 };
let activeDrag: { pointerId: number; startX: number; startY: number; moved: boolean } | null = null;
let isCancelling = false;
let isDealing = false;
let isAutoPlaying = false;
let isManualAnimating = false;
let isUndoing = false;
let autoGeneration = 0;
let manualGeneration = 0;
let dealGeneration = 0;
let pendingDealIds = new Set<string>();
let optionsOpen = false;
let superFastMode = false;
let dimUnplayableCards = false;
let autoDrawThree = false;
let autoDrawThreeOnlyAtRoundStart = false;
let isInitialDealing = false;
let moveHistory: MoveHistoryEntry[] = [];
let undoCount = 0;
const app = document.querySelector<HTMLElement>("#app")!;

function motionLayer(): HTMLElement {
  let layer = document.querySelector<HTMLElement>("#motion-layer");
  if (!layer) { layer = document.createElement("div"); layer.id = "motion-layer"; document.body.append(layer); }
  return layer;
}

function render(): void {
  app.innerHTML = `
    <header>
      <div class="title-group"><p class="eyebrow">SAWAYAMA</p><h1>Solitaire</h1></div>
      <div class="header-actions"><button id="new-game">New game</button><button id="options" type="button">Options</button><button id="undo" type="button" aria-label="Undo previous player move">Undo<span class="undo-label"><span class="undo-count">${undoCount}</span></span></button></div>
    </header>
    <section class="top-row">
      ${state.stock.length === 0
        ? `<button class="stock empty" data-destination="freeCell">${state.freeCell && selected?.source !== "freeCell" ? renderCard(state.freeCell, { source: "freeCell" }) : "<span>Space</span>"}</button>`
        : `<button class="stock" data-target="deal" ${isDealing ? "disabled" : ""} aria-label="Deal three cards; ${state.stock.length} remaining"><span class="deck-back" aria-hidden="true"></span><span class="stock-label"><span class="stock-count">${state.stock.length}</span></span></button>`}
      <div class="waste-slot" aria-label="Dealt card history"><span class="draw-base">Draw pile</span>${renderWasteHistory()}</div>
    </section>
    ${state.stock.length > 0 ? renderPeekOverlay() : ""}
    <section class="board">
      <div class="foundations">${SUITS.map(renderFoundation).join("")}</div>
      <section class="tableau" aria-label="Tableau">${state.tableau.map(renderPile).join("")}</section>
    </section>
    <p id="status" class="${message.startsWith("That") || message.startsWith("Only") || message.startsWith("Undo failed") ? "error" : ""}">${state.won ? "You won — every suit is complete." : message}</p>
    ${optionsOpen ? `<div class="options-scrim" data-options-close><section class="options-dialog" role="dialog" aria-modal="true" aria-labelledby="options-title"><button class="options-close" type="button" data-options-close aria-label="Close options">×</button><div class="options-heading"><p class="eyebrow">SAWAYAMA</p><h2 id="options-title">Solitaire</h2><p>Options</p></div><div class="option-row"><div><h3>Super fast mode</h3><p>Shorter card animations. This setting is not active yet.</p></div><label class="switch" aria-label="Enable super fast mode"><input id="super-fast-mode" type="checkbox" ${superFastMode ? "checked" : ""}><span></span></label></div><div class="option-row"><div><h3>Dim unplayable cards</h3><p>Grey cards that cannot be picked up.</p></div><label class="switch" aria-label="Dim unplayable cards"><input id="dim-unplayable-cards" type="checkbox" ${dimUnplayableCards ? "checked" : ""}><span></span></label></div><div class="option-row"><div><h3>Automatically draw 3 when empty</h3><p>Deal three cards when the waste is empty.</p></div><label class="switch" aria-label="Automatically draw three cards when empty"><input id="auto-draw-three" type="checkbox" ${autoDrawThree ? "checked" : ""}><span></span></label></div><div class="option-subrow"><div><h3>Only at round start</h3><p>Deal once after the opening tableau, preserving Undo during play.</p></div><label class="switch" aria-label="Only automatically draw three at round start"><input id="auto-draw-three-round-start" type="checkbox" ${autoDrawThreeOnlyAtRoundStart ? "checked" : ""} ${autoDrawThree ? "" : "disabled"}><span></span></label></div><p class="options-note">More settings are on the way.</p></section></div>` : ""}
    <div id="ghost" hidden>${selected ? selected.cards.map((card, index) => renderCard(card, undefined, "ghost-card", `top:${index * 34}px; z-index:${index}`)).join("") : ""}</div>
  `;
  attachEvents();
}

function renderWasteHistory(): string {
  const holdingWaste = selected?.source === "waste";
  const cards = holdingWaste ? state.waste.slice(0, -1) : state.waste;
  if (cards.length === 0) return "";
  const width = 90 + (cards.length - 1) * 34;
  return `<div class="waste-history" style="width:${width}px">${cards.map((card, index) =>
    renderCard(card, !holdingWaste && index === cards.length - 1 ? { source: "waste" } : undefined, `history-card ${dimUnplayableCards && (holdingWaste || index !== cards.length - 1) ? "unplayable" : ""}`, `left:${index * 34}px; z-index:${index}`),
  ).join("")}</div>`;
}

function renderPeekOverlay(): string {
  const remainingCardIds = new Set(state.stock.map((card) => card.id));
  const suits: Suit[] = ["spades", "hearts", "clubs", "diamonds"];
  return `<aside class="peek-overlay" aria-hidden="true"><section class="peek-panel"><div class="peek-heading"><p class="eyebrow">SAWAYAMA</p><h2>Solitaire</h2><p>PEEK</p></div><div class="peek-suits">${suits.map((suit) => `<div class="peek-row"><span class="peek-suit ${suit}">${suitSymbol(suit)}</span><div class="peek-cards">${Array.from({ length: 13 }, (_, index) => {
    const rank = index + 1;
    const card: Card = { id: `${suit}-${rank}`, suit, rank: rank as Card["rank"] };
    return renderCard(card, undefined, `peek-card ${remainingCardIds.has(card.id) ? "" : "peek-drawn"}`, `left:${index * 50}px; z-index:${index}`, false, true);
  }).join("")}</div></div>`).join("")}</div></section></aside>`;
}

function renderFoundation(suit: Suit): string {
  const cards = state.foundations[suit];
  const top = cards.at(-1);
  const underCard = top && pendingDealIds.has(top.id) ? cards.at(-2) : undefined;
  const contents = top
    ? `${underCard ? renderCard(underCard) : ""}${renderCard(top)}`
    : `<span>${suitSymbol(suit)}</span>`;
  return `<button class="foundation ${suit}" data-destination="foundation" data-suit="${suit}" aria-label="${suit} foundation">${contents}</button>`;
}

function renderPile(pile: Card[], pileIndex: number): string {
  const heldStart = selected?.source === "tableau" && selected.pile === pileIndex ? selected.startIndex : null;
  const visiblePile = heldStart === null ? pile : pile.slice(0, heldStart);
  const cards = visiblePile.map((card, cardIndex) =>
    renderCard(card, { source: "tableau", pile: pileIndex, startIndex: cardIndex }, dimUnplayableCards && !isInitialDealing && !isMovableRun(pile.slice(cardIndex)) ? "unplayable" : "", `top:${cardIndex * 34}px; z-index:${cardIndex + 1}`),
  ).join("");
  return `<button class="tableau-pile" data-destination="tableau" data-pile="${pileIndex}" aria-label="Tableau pile ${pileIndex + 1}"><span class="tableau-open">Open</span>${cards}</button>`;
}

function renderCard(card: Card, source?: CardSource, extraClass = "", inlineStyle = "", includeCardId = true, displayOnly = false): string {
  const isSelected = selected && selected.source === source?.source &&
    (source?.source !== "tableau" || (selected.source === "tableau" && selected.pile === source.pile && selected.startIndex === source.startIndex));
  const isReturning = Boolean(source) && Boolean(returningSelection?.cards.some((returningCard) => returningCard.id === card.id));
  const attrs = source?.source === "tableau"
    ? `data-source="tableau" data-pile="${source.pile}" data-start-index="${source.startIndex}"`
    : source?.source ? `data-source="${source.source}"` : "";
  const rank = rankLabel(card);
  const suit = suitSymbol(card.suit);
  return `<span class="card ${cardColor(card)} ${isSelected ? "selected" : ""} ${isReturning ? "returning-hidden" : ""} ${!displayOnly && pendingDealIds.has(card.id) ? "dealing-hidden" : ""} ${extraClass}" ${includeCardId ? `data-card-id="${card.id}"` : ""} ${attrs} ${inlineStyle ? `style="${inlineStyle}"` : ""}><b class="card-corner card-rank-top">${rank}</b><b class="card-corner card-suit-top">${suit}</b><i>${suit}</i><b class="card-corner card-suit-bottom">${suit}</b><b class="card-corner card-rank-bottom">${rank}</b></span>`;
}

function attachEvents(): void {
  document.querySelector("#new-game")?.addEventListener("click", () => {
    state = createGame(); selected = null; activeDrag = null; returningSelection = null; returnGeneration += 1; isCancelling = false; isAutoPlaying = false; isManualAnimating = false; isUndoing = false; autoGeneration += 1; manualGeneration += 1; dragGeneration += 1; moveHistory = []; undoCount = 0;
    document.querySelectorAll(".returning-ghost").forEach((ghost) => ghost.remove());
    document.querySelector<HTMLElement>("#motion-layer")?.replaceChildren();
    startInitialDeal();
  });
  document.querySelector("[data-target='deal']")?.addEventListener("click", deal);
  document.querySelector("#options")?.addEventListener("click", () => { optionsOpen = true; render(); });
  document.querySelector("#undo")?.addEventListener("click", undoLastManualMove);
  document.querySelectorAll<HTMLElement>("[data-options-close]").forEach((element) => element.addEventListener("click", (event) => {
    if (event.target === element || element.classList.contains("options-close")) { optionsOpen = false; render(); }
  }));
  document.querySelector<HTMLInputElement>("#super-fast-mode")?.addEventListener("change", (event) => {
    superFastMode = (event.currentTarget as HTMLInputElement).checked;
  });
  document.querySelector<HTMLInputElement>("#dim-unplayable-cards")?.addEventListener("change", (event) => {
    dimUnplayableCards = (event.currentTarget as HTMLInputElement).checked;
    render();
  });
  document.querySelector<HTMLInputElement>("#auto-draw-three")?.addEventListener("change", (event) => {
    autoDrawThree = (event.currentTarget as HTMLInputElement).checked;
    if (autoDrawThree) maybeAutoDrawThree();
    render();
  });
  document.querySelector<HTMLInputElement>("#auto-draw-three-round-start")?.addEventListener("change", (event) => {
    autoDrawThreeOnlyAtRoundStart = (event.currentTarget as HTMLInputElement).checked;
  });
  document.querySelector(".waste-slot")?.addEventListener("pointerdown", (event) => {
    if (event instanceof PointerEvent && event.button === 0 && selected?.source === "waste") cancelSelection();
  });
  document.querySelectorAll<HTMLElement>("[data-source]").forEach((element) => element.addEventListener("pointerdown", selectSource));
  document.querySelectorAll<HTMLElement>("[data-destination]").forEach((element) => element.addEventListener("pointerdown", moveToDestination));
}

function selectSource(event: Event): void {
  if (event instanceof PointerEvent && event.button !== 0) return;
  event.stopPropagation();
  const element = event.currentTarget as HTMLElement;
  if (isCancelling || isDealing || isUndoing) return;
  if (selected) {
    const destination = element.closest<HTMLElement>("[data-destination]");
    if (destination) moveToDestinationElement(destination);
    return;
  }

  const source = element.dataset.source;
  if (source === "tableau") {
    const pile = Number(element.dataset.pile);
    const startIndex = Number(element.dataset.startIndex);
    const cards = state.tableau[pile].slice(startIndex);
    if (!isMovableRun(cards)) {
      message = "That stack is not a valid alternating run.";
      const status = document.querySelector<HTMLElement>("#status");
      if (status) { status.textContent = message; status.classList.add("error"); }
      element.classList.remove("shake");
      void element.offsetWidth;
      element.classList.add("shake");
      return;
    }
    selected = { source, pile, startIndex, cards };
  } else if (source === "waste" && state.waste.at(-1)) {
    selected = { source, cards: [state.waste.at(-1)!] };
  } else if (source === "freeCell" && state.freeCell) {
    selected = { source, cards: [state.freeCell] };
  }
  if (!selected) return;
  claimReturningCards(selected.cards);
  const pointer = event as MouseEvent;
  const bounds = element.getBoundingClientRect();
  dragGrabOffset = { x: pointer.clientX - bounds.left, y: pointer.clientY - bounds.top };
  dragOrigin = { x: bounds.left, y: bounds.top };
  const pointerEvent = event as PointerEvent;
  activeDrag = { pointerId: pointerEvent.pointerId, startX: pointerEvent.clientX, startY: pointerEvent.clientY, moved: false };
  dragGeneration += 1;
  message = "Selected. Click a destination, or right-click to cancel.";
  render();
  positionGhost(pointer.clientX, pointer.clientY, true);
}

function moveToDestination(event: Event): void {
  if (event instanceof PointerEvent && event.button !== 0) return;
  if (!selected || isCancelling || isDealing || isUndoing) return;
  moveToDestinationElement(event.currentTarget as HTMLElement);
}

function moveToDestinationElement(target: HTMLElement): boolean {
  const destination = target.dataset.destination === "tableau"
    ? { type: "tableau", pile: Number(target.dataset.pile) } as Destination
    : target.dataset.destination === "foundation"
      ? { type: "foundation", suit: selected?.cards[0]?.suit ?? target.dataset.suit as Suit } as Destination
      : { type: "freeCell" } as Destination;
  if (selected?.source === "tableau" && destination.type === "tableau" && destination.pile === selected.pile) {
    cancelSelection();
    return true;
  }
  const action = selectionAction(destination);
  if (!action || !selected) return false;
  const movingCards = selected.cards;
  const sourceRects = heldCardRects();
  const result = applyAction(state, action);
  if (!result.moved) {
    message = result.reason ?? "That move is not allowed.";
    const status = document.querySelector<HTMLElement>("#status");
    if (status) { status.textContent = message; status.classList.add("error"); }
    target.classList.remove("shake");
    void target.offsetWidth;
    target.classList.add("shake");
    return false;
  }
  message = "Moved.";
  activeDrag = null;
  selected = null;
  dragGeneration += 1;
  moveHistory.push({ action, actor: "manual", previousState: state });
  state = result.state;
  if (sourceRects.length === movingCards.length) {
    movingCards.forEach((card) => pendingDealIds.add(card.id));
    render();
    void animateManualMove(movingCards, sourceRects, ++manualGeneration);
    void runAutoPlay();
    return true;
  }
  render();
  void runAutoPlay();
  return true;
}

function heldCardRects(): DOMRect[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#ghost .ghost-card"), (card) => card.getBoundingClientRect());
}

async function animateManualMove(cards: Card[], sourceRects: DOMRect[], generation: number): Promise<void> {
  isManualAnimating = true;
  await Promise.all(cards.map((card, index) => animateDealtCard(card, sourceRects[index], dealGeneration, 600)));
  if (generation !== manualGeneration) return;
  isManualAnimating = false;
  maybeAutoDrawThree();
}

function selectionAction(destination: Destination): Exclude<GameAction, { type: "deal" }> | null {
  if (!selected) return null;
  if (selected.source === "tableau") return { type: "moveTableau", pile: selected.pile, startIndex: selected.startIndex, destination };
  if (selected.source === "waste") return { type: "moveWaste", destination };
  if (destination.type === "freeCell") return null;
  return { type: "moveFreeCell", destination };
}

function claimReturningCards(cards: Card[]): void {
  if (!returningSelection?.cards.some((returningCard) => cards.some((card) => card.id === returningCard.id))) return;
  returningSelection = null;
  returnGeneration += 1;
  document.querySelectorAll(".returning-ghost").forEach((ghost) => ghost.remove());
}

function cancelSelection(): void {
  if (!selected) return;
  document.querySelectorAll(".returning-ghost").forEach((ghost) => ghost.remove());
  returningSelection = null;
  const cancelledSelection = selected;
  const generation = ++returnGeneration;
  const ghost = document.querySelector<HTMLElement>("#ghost");
  const returningCards = ghost ? Array.from(ghost.querySelectorAll<HTMLElement>(".ghost-card")) : [];
  if (ghost) {
    ghost.classList.add("returning-ghost");
    ghost.id = "";
    document.body.append(ghost);
    returningCards.forEach((card) => { card.classList.add("returning"); void card.offsetWidth; });
    returningCards.forEach((card, index) => window.setTimeout(() => {
      card.style.transform = `translate(${dragOrigin.x}px, ${dragOrigin.y}px)`;
    }, index * 50));
  }

  returningSelection = cancelledSelection;
  activeDrag = null;
  selected = null;
  isCancelling = false;
  dragGeneration += 1;
  message = "Move cancelled.";
  render();
  const finishReturn = () => {
    if (generation !== returnGeneration) return;
    if (selected || isDealing) { window.setTimeout(finishReturn, 50); return; }
    returningSelection = null;
    render();
    window.requestAnimationFrame(() => {
      const sourceCardsAreVisible = cancelledSelection.cards.every((card) => {
        const sourceCard = app.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
        return sourceCard && !sourceCard.classList.contains("returning-hidden") && !sourceCard.classList.contains("dealing-hidden");
      });
      if (sourceCardsAreVisible) ghost?.remove();
    });
  };
  window.setTimeout(finishReturn, (returningCards.length - 1) * 50 + 600);
}

function deal(): void {
  if (isDealing || isUndoing || state.stock.length === 0) return;
  const source = document.querySelector<HTMLElement>(".stock")?.getBoundingClientRect();
  const cards = state.stock.slice(0, 3);
  const result = applyAction(state, { type: "deal" });
  if (!result.moved || !source) return;
  state = result.state;
  moveHistory = [];
  selected = null;
  isCancelling = false;
  dragGeneration += 1;
  isDealing = true;
  pendingDealIds = new Set(cards.map((card) => card.id));
  message = "Dealing three cards...";
  render();
  void playDealSequence(cards, source, "Three cards dealt. Only the top card is playable.", ++dealGeneration);
}

function startInitialDeal(): void {
  isInitialDealing = true;
  const cards: Card[] = []; 
  for (let round = 0; round < 7; round += 1) {
    for (let pile = round; pile < 7; pile += 1) cards.push(state.tableau[pile][round]);
  }
  isDealing = true;
  pendingDealIds = new Set(cards.map((card) => card.id));
  message = "Dealing the opening tableau...";
  render();
  const source = document.querySelector<HTMLElement>(".stock")?.getBoundingClientRect();
  if (!source) return;
  void playDealSequence(cards, source, "Opening tableau dealt.", ++dealGeneration, true);
}

async function playDealSequence(cards: Card[], source: DOMRect, completeMessage: string, generation: number, isRoundStart = false): Promise<void> {
  await runDealQueue(cards, (card) => animateDealtCard(card, source, generation));
  if (generation !== dealGeneration) return;
  isDealing = false;
  isInitialDealing = false;
  message = completeMessage;
  render();
  if (!maybeAutoDrawThree(isRoundStart)) void runAutoPlay();
}

async function runAutoPlay(): Promise<void> {
  if (isDealing || isUndoing || isAutoPlaying || selected) return;
  isAutoPlaying = true;
  const generation = ++autoGeneration;
  let duration = 600;
  let action = findAutoPlayAction(state);
  while (action) {
    const card = cardForAutoAction(action);
    const source = card && app.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`)?.getBoundingClientRect();
    if (!card || !source) break;
    const result = applyAction(state, action);
    if (!result.moved) break;
    moveHistory.push({ action, actor: "auto", previousState: state });
    state = result.state;
    pendingDealIds.add(card.id);
    message = `Auto-playing ${cardLabel(card)}...`;
    render();
    await animateDealtCard(card, source, dealGeneration, duration);
    if (generation !== autoGeneration || isDealing) return;
    duration = Math.max(150, duration - 50);
    if (selected) { isAutoPlaying = false; return; }
    action = findAutoPlayAction(state);
  }
  if (generation !== autoGeneration) return;
  isAutoPlaying = false;
  if (message.startsWith("Auto-playing")) message = "Auto-play complete.";
  if (!selected) {
    render();
    maybeAutoDrawThree();
  }
}

async function undoLastManualMove(): Promise<void> {
  if (isUndoing) return;
  if (isDealing) {
    message = "Undo failed: wait for the card draw to finish.";
    render();
    return;
  }
  const undoResult = undoLatestManualMove(moveHistory);
  if (!undoResult) {
    message = "Undo failed: there is no player move to undo.";
    render();
    return;
  }

  isUndoing = true;
  activeDrag = null;
  selected = null;
  returningSelection = null;
  isCancelling = false;
  isAutoPlaying = false;
  isManualAnimating = false;
  autoGeneration += 1;
  manualGeneration += 1;
  dragGeneration += 1;
  const generation = ++dealGeneration;
  pendingDealIds.clear();
  document.querySelectorAll(".returning-ghost").forEach((ghost) => ghost.remove());
  motionLayer().replaceChildren();
  render();

  for (const entry of undoResult.entries) {
    const cards = cardsForUndo(entry, state);
    const sourceRects = cards.map((card) => app.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`)?.getBoundingClientRect());
    state = entry.previousState;
    cards.forEach((card) => pendingDealIds.add(card.id));
    render();
    let cardIndex = 0;
    await runDealQueue(cards, (card) => {
      const source = sourceRects[cardIndex++];
      if (!source) { pendingDealIds.delete(card.id); return Promise.resolve(); }
      return animateDealtCard(card, source, generation);
    });
  }

  if (generation !== dealGeneration) return;
  moveHistory = undoResult.history;
  isUndoing = false;
  undoCount += 1;
  message = undoResult.undone > 1 ? `Undid your move and ${undoResult.undone - 1} auto-played card${undoResult.undone === 2 ? "" : "s"}.` : "Undid your move.";
  render();
}

function cardsForUndo(entry: MoveHistoryEntry, stateAfterMove: GameState): Card[] {
  const { action } = entry;
  if (action.destination.type === "tableau") {
    const count = action.type === "moveTableau" ? entry.previousState.tableau[action.pile].length - action.startIndex : 1;
    return stateAfterMove.tableau[action.destination.pile].slice(-count);
  }
  if (action.destination.type === "foundation") return stateAfterMove.foundations[action.destination.suit].slice(-1);
  return stateAfterMove.freeCell ? [stateAfterMove.freeCell] : [];
}

function maybeAutoDrawThree(isRoundStart = false): boolean {
  if (!autoDrawThree || (autoDrawThreeOnlyAtRoundStart && !isRoundStart) || isDealing || isUndoing || isManualAnimating || isAutoPlaying || selected || state.stock.length === 0 || state.waste.length > 0) return false;
  deal();
  return true;
}

function cardForAutoAction(action: GameAction): Card | null {
  if (action.type === "moveTableau") return state.tableau[action.pile].at(-1) ?? null;
  if (action.type === "moveWaste") return state.waste.at(-1) ?? null;
  if (action.type === "moveFreeCell") return state.freeCell;
  return null;
}

function animateDealtCard(card: Card, source: DOMRect, generation: number, duration = 260, destinationOverride?: DOMRect): Promise<void> {
  return new Promise((resolve) => {
    if (generation !== dealGeneration) { resolve(); return; }
    const target = app.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
    const layer = motionLayer();
    const destination = destinationOverride ?? target?.getBoundingClientRect();
    if (!destination) { resolve(); return; }
    const template = document.createElement("template");
    template.innerHTML = renderCard(card, undefined, "deal-animation-card");
    const flyingCard = template.content.firstElementChild as HTMLElement;
    flyingCard.classList.remove("dealing-hidden");
    flyingCard.style.left = `${source.left}px`;
    flyingCard.style.top = `${source.top}px`;
    flyingCard.style.transform = "translate(0, 0)";
    layer.append(flyingCard);

    window.requestAnimationFrame(() => {
      flyingCard.style.transition = `transform ${duration}ms cubic-bezier(.2, .8, .2, 1)`;
      flyingCard.style.transform = `translate(${destination.left - source.left}px, ${destination.top - source.top}px)`;
    });
    window.setTimeout(() => {
      if (generation !== dealGeneration) { flyingCard.remove(); resolve(); return; }
      pendingDealIds.delete(card.id);
      const landedCard = app.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
      landedCard?.classList.remove("dealing-hidden");
      if (landedCard?.closest(".foundation")) {
        landedCard.classList.remove("foundation-pop");
        void landedCard.offsetWidth;
        landedCard.classList.add("foundation-pop");
        window.setTimeout(() => landedCard.classList.remove("foundation-pop"), 140);
      }
      window.requestAnimationFrame(() => { flyingCard.remove(); resolve(); });
    }, duration + 20);
  });
}

function suitSymbol(suit: Suit): string {
  return { diamonds: "♦", clubs: "♣", spades: "♠", hearts: "♥" }[suit];
}

window.addEventListener("contextmenu", (event) => {
  if (!selected) return;
  event.preventDefault();
  cancelSelection();
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.repeat && !optionsOpen) {
    event.preventDefault();
    undoLastManualMove();
    return;
  }
  if (event.key === "Shift" && state.stock.length > 0 && !optionsOpen) document.body.classList.add("peek-key-held");
  if (event.key === "Escape" && optionsOpen) {
    event.preventDefault();
    optionsOpen = false;
    render();
    return;
  }
  if (event.key === "Escape" && selected) {
    event.preventDefault();
    cancelSelection();
    return;
  }
  if (event.code === "Space" && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    deal();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "Shift") document.body.classList.remove("peek-key-held");
});
window.addEventListener("blur", () => document.body.classList.remove("peek-key-held"));

function positionGhost(clientX: number, clientY: number, spawnInPlace = false): void {
  if (!selected) return;
  const generation = dragGeneration;
  const cardCount = selected.cards.length;
  const moveGhostCard = (index: number) => {
    if (generation !== dragGeneration) return;
    const ghost = document.querySelector<HTMLElement>("#ghost");
    const card = ghost?.querySelector<HTMLElement>(`.ghost-card:nth-child(${index + 1})`);
    if (!ghost || !card) return;
    ghost.hidden = false;
    if (spawnInPlace) card.style.transition = "none";
    card.style.transform = `translate(${clientX - dragGrabOffset.x}px, ${clientY - dragGrabOffset.y}px)`;
    if (spawnInPlace) window.requestAnimationFrame(() => { card.style.transition = ""; });
  };
  if (spawnInPlace) {
    for (let index = 0; index < cardCount; index += 1) moveGhostCard(index);
    return;
  }
  moveGhostCard(0);
  for (let index = 1; index < cardCount; index += 1) window.setTimeout(() => moveGhostCard(index), index * 50);
}

window.addEventListener("pointermove", (event) => {
  if (isCancelling || !selected) return;
  if (activeDrag?.pointerId === event.pointerId && Math.hypot(event.clientX - activeDrag.startX, event.clientY - activeDrag.startY) > 6) activeDrag.moved = true;
  positionGhost(event.clientX, event.clientY);
});

window.addEventListener("pointerup", (event) => {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
  const dragged = activeDrag.moved;
  activeDrag = null;
  if (!dragged || !selected || isCancelling || isDealing || isUndoing) return;
  const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-destination]");
  if (!destination || !moveToDestinationElement(destination)) cancelSelection();
});

startInitialDeal();
