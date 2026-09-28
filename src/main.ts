import "./style.css";
import { runDealQueue } from "./deal-queue";
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
let isCancelling = false;
let isDealing = false;
let isAutoPlaying = false;
let isManualAnimating = false;
let autoGeneration = 0;
let manualGeneration = 0;
let dealGeneration = 0;
let pendingDealIds = new Set<string>();
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
      <div class="header-actions"><button id="new-game">New game</button><button id="options" type="button">Options</button></div>
    </header>
    <section class="top-row">
      ${state.stock.length === 0
        ? `<button class="stock empty" data-destination="freeCell">${state.freeCell && selected?.source !== "freeCell" ? renderCard(state.freeCell, { source: "freeCell" }) : "<span>Free cell</span>"}</button>`
        : `<button class="stock" data-target="deal" ${isDealing ? "disabled" : ""} aria-label="Deal three cards; ${state.stock.length} remaining"><span class="deck-back" aria-hidden="true"></span><span class="stock-label">${state.stock.length}</span></button>`}
      <div class="waste-slot" aria-label="Dealt card history"><span class="draw-base">Draw pile</span>${renderWasteHistory()}</div>
    </section>
    <section class="board">
      <div class="foundations">${SUITS.map(renderFoundation).join("")}</div>
      <section class="tableau" aria-label="Tableau">${state.tableau.map(renderPile).join("")}</section>
    </section>
    <p id="status" class="${message.startsWith("That") || message.startsWith("Only") ? "error" : ""}">${state.won ? "You won — every suit is complete." : message}</p>
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
    renderCard(card, !holdingWaste && index === cards.length - 1 ? { source: "waste" } : undefined, "history-card", `left:${index * 34}px; z-index:${index}`),
  ).join("")}</div>`;
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
    renderCard(card, { source: "tableau", pile: pileIndex, startIndex: cardIndex }, "", `top:${cardIndex * 34}px; z-index:${cardIndex + 1}`),
  ).join("");
  return `<button class="tableau-pile" data-destination="tableau" data-pile="${pileIndex}" aria-label="Tableau pile ${pileIndex + 1}"><span class="tableau-open">Open</span>${cards}</button>`;
}

function renderCard(card: Card, source?: CardSource, extraClass = "", inlineStyle = ""): string {
  const isSelected = selected && selected.source === source?.source &&
    (source?.source !== "tableau" || (selected.source === "tableau" && selected.pile === source.pile && selected.startIndex === source.startIndex));
  const isReturning = Boolean(source) && Boolean(returningSelection?.cards.some((returningCard) => returningCard.id === card.id));
  const attrs = source?.source === "tableau"
    ? `data-source="tableau" data-pile="${source.pile}" data-start-index="${source.startIndex}"`
    : source?.source ? `data-source="${source.source}"` : "";
  const rank = rankLabel(card);
  const suit = suitSymbol(card.suit);
  return `<span class="card ${cardColor(card)} ${isSelected ? "selected" : ""} ${isReturning ? "returning-hidden" : ""} ${pendingDealIds.has(card.id) ? "dealing-hidden" : ""} ${extraClass}" data-card-id="${card.id}" ${attrs} ${inlineStyle ? `style="${inlineStyle}"` : ""}><b class="card-corner card-rank-top">${rank}</b><b class="card-corner card-suit-top">${suit}</b><i>${suit}</i><b class="card-corner card-suit-bottom">${suit}</b><b class="card-corner card-rank-bottom">${rank}</b></span>`;
}

function attachEvents(): void {
  document.querySelector("#new-game")?.addEventListener("click", () => {
    state = createGame(); selected = null; returningSelection = null; returnGeneration += 1; isCancelling = false; isAutoPlaying = false; isManualAnimating = false; autoGeneration += 1; manualGeneration += 1; dragGeneration += 1;
    document.querySelectorAll(".returning-ghost").forEach((ghost) => ghost.remove());
    document.querySelector<HTMLElement>("#motion-layer")?.replaceChildren();
    startInitialDeal();
  });
  document.querySelector("[data-target='deal']")?.addEventListener("click", deal);
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
  if (isCancelling || isDealing) return;
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
  dragGeneration += 1;
  message = "Selected. Click a destination, or right-click to cancel.";
  render();
  positionGhost(pointer.clientX, pointer.clientY, true);
}

function moveToDestination(event: Event): void {
  if (event instanceof PointerEvent && event.button !== 0) return;
  if (!selected || isCancelling || isDealing) return;
  moveToDestinationElement(event.currentTarget as HTMLElement);
}

function moveToDestinationElement(target: HTMLElement): void {
  const destination = target.dataset.destination === "tableau"
    ? { type: "tableau", pile: Number(target.dataset.pile) } as Destination
    : target.dataset.destination === "foundation"
      ? { type: "foundation", suit: selected?.cards[0]?.suit ?? target.dataset.suit as Suit } as Destination
      : { type: "freeCell" } as Destination;
  if (selected?.source === "tableau" && destination.type === "tableau" && destination.pile === selected.pile) {
    cancelSelection();
    return;
  }
  const action = selectionAction(destination);
  if (!action || !selected) return;
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
    return;
  }
  message = "Moved.";
  selected = null;
  dragGeneration += 1;
  state = result.state;
  if (sourceRects.length === movingCards.length) {
    movingCards.forEach((card) => pendingDealIds.add(card.id));
    render();
    void animateManualMove(movingCards, sourceRects, ++manualGeneration);
    void runAutoPlay();
    return;
  }
  render();
  void runAutoPlay();
}

function heldCardRects(): DOMRect[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#ghost .ghost-card"), (card) => card.getBoundingClientRect());
}

async function animateManualMove(cards: Card[], sourceRects: DOMRect[], generation: number): Promise<void> {
  await Promise.all(cards.map((card, index) => animateDealtCard(card, sourceRects[index], dealGeneration, 600)));
  if (generation !== manualGeneration) return;
}

function selectionAction(destination: Destination): GameAction | null {
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
  if (isDealing || state.stock.length === 0) return;
  const source = document.querySelector<HTMLElement>(".stock")?.getBoundingClientRect();
  const cards = state.stock.slice(0, 3);
  const result = applyAction(state, { type: "deal" });
  if (!result.moved || !source) return;
  state = result.state;
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
  void playDealSequence(cards, source, "Opening tableau dealt.", ++dealGeneration);
}

async function playDealSequence(cards: Card[], source: DOMRect, completeMessage: string, generation: number): Promise<void> {
  await runDealQueue(cards, (card) => animateDealtCard(card, source, generation));
  if (generation !== dealGeneration) return;
  isDealing = false;
  message = completeMessage;
  render();
  void runAutoPlay();
}

async function runAutoPlay(): Promise<void> {
  if (isDealing || isAutoPlaying || selected) return;
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
  if (!selected) render();
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
  if (!isCancelling) positionGhost(event.clientX, event.clientY);
});

startInitialDeal();
