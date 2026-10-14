import { describe, expect, it } from "vitest";
import {
  createEmptyBoardDocument,
  getVisibleStrokes,
  isBoardDocument,
  mergeBoardDocuments,
  setStroke,
  setEquationText,
  setKnown,
  setKnownValue,
} from "./board-document";

describe("shared board document", () => {
  it("merges concurrent equation, variable, and sketch changes without losing either device's edits", () => {
    const empty = createEmptyBoardDocument();
    const ipad = setStroke(
      empty,
      "ipad-stroke",
      [{ x: 0.2, y: 0.4, pressure: 0.5 }],
      false,
      "ipad",
      { color: "red", mode: "straight" },
    );
    const desktop = setEquationText(empty, "Fx=10", "desktop");

    const merged = mergeBoardDocuments(ipad, desktop);

    expect(merged.equationText.value).toBe("Fx=10");
    expect(getVisibleStrokes(merged).map(({ id }) => id)).toEqual(["ipad-stroke"]);
    expect(merged.strokes["ipad-stroke"]).toMatchObject({ color: "red", mode: "straight" });
  });

  it("merges known values and marks independently by variable", () => {
    const empty = createEmptyBoardDocument();
    const ipad = setKnown(empty, "Fx", true, "ipad");
    const desktop = setKnownValue(empty, "Fx", "24", "desktop");
    const merged = mergeBoardDocuments(ipad, desktop);

    expect(merged.known.Fx.value).toBe(true);
    expect(merged.knownValues.Fx.value).toBe("24");
  });

  it("keeps a newer stroke deletion when receiving an older snapshot", () => {
    const empty = createEmptyBoardDocument();
    const stroke = setStroke(empty, "stroke", [{ x: 0.2, y: 0.4, pressure: 0.5 }], false, "ipad");
    const deleted = setStroke(stroke, "stroke", [], true, "ipad");

    expect(getVisibleStrokes(mergeBoardDocuments(deleted, stroke))).toEqual([]);
  });

  it("rejects malformed and oversized remote board snapshots", () => {
    const valid = createEmptyBoardDocument();
    expect(isBoardDocument(valid)).toBe(true);
    expect(isBoardDocument({ ...valid, equationText: { ...valid.equationText, value: 1 } })).toBe(false);
    expect(isBoardDocument({
      ...valid,
      strokes: {
        stroke: {
          points: [{ x: 2, y: 0, pressure: 0.5 }],
          deleted: false,
          revision: { counter: 1, clientId: "peer" },
          created: { counter: 1, clientId: "peer" },
        },
      },
    })).toBe(false);
    const styled = setStroke(valid, "00000000-0000-4000-8000-000000000001", [], false, "ipad", {
      color: "green",
      mode: "circle",
    });
    expect(isBoardDocument(styled)).toBe(true);
    const arrow = setStroke(styled, "00000000-0000-4000-8000-000000000004", [], false, "ipad", {
      color: "red",
      mode: "arrow",
    });
    const eraser = setStroke(arrow, "00000000-0000-4000-8000-000000000005", [], false, "ipad", {
      color: "navy",
      mode: "eraser",
    });
    expect(isBoardDocument(eraser)).toBe(true);
    expect(isBoardDocument({
      ...eraser,
      strokes: {
        ...eraser.strokes,
        "00000000-0000-4000-8000-000000000002": {
          ...eraser.strokes["00000000-0000-4000-8000-000000000001"],
          color: "ultraviolet",
        },
      },
    })).toBe(false);
  });

  it("keeps a stroke's style when recording a deletion", () => {
    const document = setStroke(
      createEmptyBoardDocument(),
      "00000000-0000-4000-8000-000000000003",
      [{ x: 0.1, y: 0.2, pressure: 0.5 }],
      false,
      "ipad",
      { color: "blue", mode: "straight" },
    );
    const deleted = setStroke(document, "00000000-0000-4000-8000-000000000003", [], true, "ipad");

    expect(deleted.strokes["00000000-0000-4000-8000-000000000003"]).toMatchObject({
      deleted: true,
      color: "blue",
      mode: "straight",
    });
  });
});
