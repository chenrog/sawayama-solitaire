import { describe, expect, it } from "vitest";
import { runDealQueue } from "./deal-queue";

describe("runDealQueue", () => {
  it("starts the next card only after the prior card finishes", async () => {
    const events: string[] = [];
    const finishers: Array<() => void> = [];
    const queue = runDealQueue(["first", "second", "third"], (card) => new Promise<void>((resolve) => {
      events.push(`start:${card}`);
      finishers.push(() => { events.push(`finish:${card}`); resolve(); });
    }));

    await Promise.resolve();
    expect(events).toEqual(["start:first"]);

    finishers[0]();
    await Promise.resolve();
    expect(events).toEqual(["start:first", "finish:first", "start:second"]);

    finishers[1]();
    await Promise.resolve();
    expect(events).toEqual(["start:first", "finish:first", "start:second", "finish:second", "start:third"]);

    finishers[2]();
    await queue;
  });
});
