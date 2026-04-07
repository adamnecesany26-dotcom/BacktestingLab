import { describe, expect, it } from "vitest";
import { remapViewMarkersBarIndexForWindow } from "./viewDemoObdobiSlice";

describe("remapViewMarkersBarIndexForWindow", () => {
  it("maps global bar_index to tail window coordinates", () => {
    const fullLen = 30;
    const windowLen = 10;
    const startIdx = fullLen - windowLen;
    const markers = [
      { date: "2024-06-26", type: "high", value: 105, bar_index: 25 },
      { date: "2024-06-01", type: "low", value: 90, bar_index: 0 },
    ].filter((m) => {
      const ds = m.date.slice(0, 10);
      return ds >= "2024-06-21" && ds <= "2024-06-30";
    });
    const out = remapViewMarkersBarIndexForWindow(markers, startIdx, windowLen);
    expect(out).toHaveLength(1);
    expect(out[0].bar_index).toBe(5);
  });

  it("drops bar_index when global index falls outside window (rely on date)", () => {
    const windowLen = 10;
    const startIdx = 20;
    const markers = [{ date: "2024-06-25", type: "high", value: 1, bar_index: 3 }];
    const out = remapViewMarkersBarIndexForWindow(markers, startIdx, windowLen);
    expect(out[0].bar_index).toBeUndefined();
  });

  it("passes through markers without bar_index", () => {
    const out = remapViewMarkersBarIndexForWindow(
      [{ date: "x", type: "high", value: 1 }],
      5,
      10
    );
    expect(out[0].bar_index).toBeUndefined();
  });
});
