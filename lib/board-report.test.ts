import { describe, expect, it } from "vitest";
import { createBoardReport, findSketchBounds } from "./board-report";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";
const bluePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";

describe("findSketchBounds", () => {
  it("frames the visible strokes with padding instead of the whole canvas", () => {
    const width = 100;
    const height = 80;
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of [[40, 30], [41, 30], [42, 31]]) data[(y * width + x) * 4 + 3] = 255;

    expect(findSketchBounds({ width, height, data })).toEqual({ x: 34, y: 24, width: 15, height: 14 });
  });

  it("keeps marks at the canvas edge inside the crop", () => {
    const width = 20;
    const height = 12;
    const data = new Uint8ClampedArray(width * height * 4);
    data[3] = 255;
    data[((height - 1) * width + width - 1) * 4 + 3] = 255;

    expect(findSketchBounds({ width, height, data })).toEqual({ x: 0, y: 0, width, height });
  });

  it("returns no bounds for a blank sketch", () => {
    expect(findSketchBounds({ width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4) })).toBeNull();
  });
});

describe("createBoardReport", () => {
  it("creates a single-page PDF containing both report images", () => {
    const report = createBoardReport({
      title: "Bracket FBD",
      generatedAt: new Date("2026-10-14T12:00:00Z"),
      equations: "Fx = 0\nFy = m*g",
      variables: [
        { name: "Fx", known: false, value: "" },
        { name: "m", known: true, value: "4.5" },
        { name: "g", known: false, calculated: true, value: "14" },
      ],
      sketchPng: onePixelPng,
      plot: { png: bluePixelPng, driver: "x", response: "y" },
    });

    expect(report.internal.pages.length - 1).toBe(1);
    const bytes = new Uint8Array(report.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.3");
    expect((report.output() as string).match(/\/Subtype\s*\/Image/g)).toHaveLength(2);
    expect(report.output()).toContain("g = 14 \\(calculated\\)");
  });

  it("rejects content that cannot fit legibly on one page", () => {
    expect(() => createBoardReport({
      title: "Long report",
      generatedAt: new Date("2026-10-14T12:00:00Z"),
      equations: Array.from({ length: 500 }, (_, index) => `equation_${index} = ${"x".repeat(100)}`).join("\n"),
      variables: [],
      sketchPng: onePixelPng,
    })).toThrow(/too long for one page/i);
  });
});
