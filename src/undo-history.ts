import type { GameAction, GameState } from "./engine";

export type MoveHistoryEntry = {
  action: Exclude<GameAction, { type: "deal" }>;
  actor: "manual" | "auto";
  previousState: GameState;
};

export function undoLatestManualMove(history: readonly MoveHistoryEntry[]): {
  state: GameState;
  history: MoveHistoryEntry[];
  undone: number;
  entries: MoveHistoryEntry[];
} | null {
  if (!history.some((entry) => entry.actor === "manual")) return null;

  const remaining = [...history];
  let entry: MoveHistoryEntry | undefined;
  let state: GameState | undefined;
  let undone = 0;
  const entries: MoveHistoryEntry[] = [];
  do {
    entry = remaining.pop();
    if (!entry) break;
    state = entry.previousState;
    entries.push(entry);
    undone += 1;
  } while (entry.actor === "auto");

  return state ? { state, history: remaining, undone, entries } : null;
}
