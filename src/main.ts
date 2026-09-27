import "./style.css";
import { runDealQueue } from "./deal-queue";
import {
  SUITS,
  applyAction,
  cardColor,
  cardLabel,
  createGame,
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
let message = "Select a card or a valid run.";
let dragGeneration = 0;
let dragGrabOffset = { x: 0, y: 0 };
let dragOrigin = { x: 0, y: 0 };
let isCancelling = false;
let isDealing = false;
let dealGeneration = 0;
let pendingDealIds = new Set<string>();
const app = document.querySelector<HTMLElement>("#app")!;

function render(): void {
  app.innerHTML = `
    <header>
      <div><p class="eyebrow">SAWAYAMA</p><h1>Solitaire</h1></div>
      <button id="new-game">New game</button>
    </header>
    <section class="top-row">
      ${state.stock.length === 0
        ? `<button class="stock empty" data-destination="freeCell">${state.freeCell && selected?.source !== "freeCell" ? renderCard(state.freeCell, { source: "freeCell" }) : "<span>Free cell</span>"}</button>`
        : `<button class="stock" data-target="deal" ${isDealing ? "disabled" : ""}><span class="deck-back" aria-hidden="true"></span><span class="stock-label">Deal 3<strong>${state.stock.length}</strong></span></button>`}
      <div class="waste-slot" aria-label="Dealt card history">${renderWasteHistory()}</div>
    </section>
    <section class="board">
      <div class="foundations">${SUITS.map(renderFoundation).join("")}</div>
      <section class="tableau" aria-label="Tableau">${state.tableau.map(renderPile).join("")}</section>
    </section>
    <p id="status" class="${message.startsWith("That") || message.startsWith("Only") ? "error" : ""}">${state.won ? "You won — every suit is complete." : message}</p>
    <div id="ghost" hidden>${selected ? selected.cards.map((card, index) => renderCard(card, undefined, "ghost-card", `top:${index * 34}px; z-index:${index}`)).join("") : ""}</div>
    <div id="deal-animation-layer" aria-hidden="true"></div>
  `;
  attachEvents();
}

function renderWasteHistory(): string {
  const holdingWaste = selected?.source === "waste";
  const cards = holdingWaste ? state.waste.slice(0, -1) : state.waste;
  if (cards.length === 0) return "<span>Draw pile</span>";
  const width = 90 + (cards.length - 1) * 34;
  return `<div class="waste-history" style="width:${width}px">${cards.map((card, index) =>
    renderCard(card, !holdingWaste && index === cards.length - 1 ? { source: "waste" } : undefined, "history-card", `left:${index * 34}px; z-index:${index}`),
  ).join("")}</div>`;
}

function renderFoundation(suit: Suit): string {
  const top = state.foundations[suit].at(-1);
  return `<button class="foundation ${suit}" data-destination="foundation" data-suit="${suit}" aria-label="${suit} foundation">${top ? renderCard(top) : `<span>${suitSymbol(suit)}</span>`}</button>`;
}

function renderPile(pile: Card[], pileIndex: number): string {
  const visiblePile = selected?.source === "tableau" && selected.pile === pileIndex ? pile.slice(0, selected.startIndex) : pile;
  const cards = visiblePile.map((card, cardIndex) =>
    renderCard(card, { source: "tableau", pile: pileIndex, startIndex: cardIndex }, "", `top:${cardIndex * 34}px; z-index:${cardIndex + 1}`),
  ).join("");
  return `<button class="tableau-pile" data-destination="tableau" data-pile="${pileIndex}" aria-label="Tableau pile ${pileIndex + 1}"><span class="tableau-open">Open</span>${cards}</button>`;
}

function renderCard(card: Card, source?: CardSource, extraClass = "", inlineStyle = ""): string {
  const isSelected = selected && selected.source === source?.source &&
    (source?.source !== "tableau" || (selected.source === "tableau" && selected.pile === source.pile && selected.startIndex === source.startIndex));
  const attrs = source?.source === "tableau"
    ? `data-source="tableau" data-pile="${source.pile}" data-start-index="${source.startIndex}"`
    : source?.source ? `data-source="${source.source}"` : "";
  const rank = rankLabel(card);
  const suit = suitSymbol(card.suit);
  return `<span class="card ${cardColor(card)} ${isSelected ? "selected" : ""} ${pendingDealIds.has(card.id) ? "dealing-hidden" : ""} ${extraClass}" data-card-id="${card.id}" ${attrs} ${inlineStyle ? `style="${inlineStyle}"` : ""}><b class="card-corner card-rank-top">${rank}</b><b class="card-corner card-suit-top">${suit}</b><i>${suit}</i><b class="card-corner card-suit-bottom">${suit}</b><b class="card-corner card-rank-bottom">${rank}</b></span>`;
}

function attachEvents(): void {
  document.querySelector("#new-game")?.addEventListener("click", () => {
    state = createGame(); selected = null; isCancelling = false; dragGeneration += 1;
    startInitialDeal();
  });
  document.querySelector("[data-target='deal']")?.addEventListener("click", deal);
  document.querySelectorAll<HTMLElement>("[data-source]").forEach((element) => element.addEventListener("click", selectSource));
  document.querySelectorAll<HTMLElement>("[data-destination]").forEach((element) => element.addEventListener("click", moveToDestination));
}

function selectSource(event: Event): void {
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
    selected = { source, pile, startIndex, cards: state.tableau[pile].slice(startIndex) };
  } else if (source === "waste" && state.waste.at(-1)) {
    selected = { source, cards: [state.waste.at(-1)!] };
  } else if (source === "freeCell" && state.freeCell) {
    selected = { source, cards: [state.freeCell] };
  }
  if (!selected) return;
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
  if (!selected || isCancelling || isDealing) return;
  moveToDestinationElement(event.currentTarget as HTMLElement);
}

function moveToDestinationElement(target: HTMLElement): void {
  const destination = target.dataset.destination === "tableau"
    ? { type: "tableau", pile: Number(target.dataset.pile) } as Destination
    : target.dataset.destination === "foundation"
      ? { type: "foundation", suit: target.dataset.suit as Suit } as Destination
      : { type: "freeCell" } as Destination;
  if (selected?.source === "tableau" && destination.type === "tableau" && destination.pile === selected.pile) {
    cancelSelection();
    return;
  }
  const action = selectionAction(destination);
  if (!action) return;
  const result = applyAction(state, action);
  message = result.moved ? "Moved." : result.reason ?? "That move is not allowed.";
  if (result.moved) { selected = null; dragGeneration += 1; }
  state = result.state;
  render();
  if (!result.moved) target.classList.add("shake");
}

function selectionAction(destination: Destination): GameAction | null {
  if (!selected) return null;
  if (selected.source === "tableau") return { type: "moveTableau", pile: selected.pile, startIndex: selected.startIndex, destination };
  if (selected.source === "waste") return { type: "moveWaste", destination };
  if (destination.type === "freeCell") return null;
  return { type: "moveFreeCell", destination };
}

function cancelSelection(): void {
  if (!selected || isCancelling) return;
  isCancelling = true;
  message = "Move cancelled.";
  const generation = dragGeneration;
  const cardCount = selected.cards.length;
  positionGhost(dragOrigin.x + dragGrabOffset.x, dragOrigin.y + dragGrabOffset.y);
  window.setTimeout(() => {
    if (generation !== dragGeneration) return;
    selected = null;
    isCancelling = false;
    dragGeneration += 1;
    render();
  }, (cardCount - 1) * 50 + 120);
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
}

function animateDealtCard(card: Card, source: DOMRect, generation: number): Promise<void> {
  return new Promise((resolve) => {
    if (generation !== dealGeneration) { resolve(); return; }
    const target = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
    const layer = document.querySelector<HTMLElement>("#deal-animation-layer");
    if (!target || !layer) { resolve(); return; }
    const destination = target.getBoundingClientRect();
    const template = document.createElement("template");
    template.innerHTML = renderCard(card, undefined, "deal-animation-card");
    const flyingCard = template.content.firstElementChild as HTMLElement;
    flyingCard.classList.remove("dealing-hidden");
    flyingCard.style.left = `${source.left}px`;
    flyingCard.style.top = `${source.top}px`;
    flyingCard.style.transform = "translate(0, 0)";
    layer.append(flyingCard);

    window.requestAnimationFrame(() => {
      flyingCard.style.transition = "transform 260ms cubic-bezier(.2, .8, .2, 1)";
      flyingCard.style.transform = `translate(${destination.left - source.left}px, ${destination.top - source.top}px)`;
    });
    window.setTimeout(() => {
      if (generation === dealGeneration) {
        pendingDealIds.delete(card.id);
        target.classList.remove("dealing-hidden");
      }
      flyingCard.remove();
      resolve();
    }, 280);
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
