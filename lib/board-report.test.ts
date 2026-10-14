import { describe, expect, it } from "vitest";
import { createBoardReport } from "./board-report";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";
const bluePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";

describe("createBoardReport", () => {
  it("creates a single-page PDF containing both report images", () => {
    const report = createBoardReport({
      title: "Bracket FBD",
      generatedAt: new Date("2026-10-14T12:00:00Z"),
      equations: "Fx = 0\nFy = m*g",
      variables: [
        { name: "Fx", known: false, value: "" },
        { name: "m", known: true, value: "4.5" },
      ],
      sketchPng: onePixelPng,
      plot: { png: bluePixelPng, driver: "x", response: "y" },
    });

    expect(report.internal.pages.length - 1).toBe(1);
    const bytes = new Uint8Array(report.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.3");
    expect((report.output() as string).match(/\/Subtype\s*\/Image/g)).toHaveLength(2);
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
