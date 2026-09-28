import { describe, expect, it } from "vitest";
import type { GameState } from "./engine";
import { undoLatestManualMove, type MoveHistoryEntry } from "./undo-history";

const state = (marker: string): GameState => ({
  tableau: Array.from({ length: 7 }, () => []),
  stock: [],
  waste: [{ id: marker, suit: "hearts", rank: 1 }],
  foundations: { diamonds: [], clubs: [], spades: [], hearts: [] },
  freeCell: null,
  won: false,
});

const entry = (actor: MoveHistoryEntry["actor"], previousState: GameState): MoveHistoryEntry => ({
  actor,
  previousState,
  action: { type: "moveWaste", destination: { type: "foundation", suit: "hearts" } },
});

describe("undo move history", () => {
  it("undoes later auto moves together with the latest manual move", () => {
    const earlier = state("earlier");
    const beforeManual = state("manual");
    const beforeAuto = state("auto");
    const result = undoLatestManualMove([
      entry("manual", earlier),
      entry("manual", beforeManual),
      entry("auto", beforeAuto),
    ]);

    expect(result).toMatchObject({ state: beforeManual, undone: 2 });
    expect(result?.history).toEqual([entry("manual", earlier)]);
  });

  it("does not undo auto-play when there is no player move", () => {
    expect(undoLatestManualMove([entry("auto", state("auto"))])).toBeNull();
  });
});
