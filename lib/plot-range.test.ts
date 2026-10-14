import { describe, expect, it } from "vitest";
import { validateAxisRange } from "./plot-range";

describe("plot axis range validation", () => {
  it("accepts finite increasing ranges, including negative and fractional bounds", () => {
    expect(validateAxisRange("-2.5", "0.75")).toEqual({
      ok: true,
      range: { min: -2.5, max: 0.75 },
    });
  });

  it.each([
    ["", "10"],
    ["0", ""],
    ["not a number", "10"],
    ["0", "Infinity"],
    ["4", "4"],
    ["5", "-5"],
    ["-1.7e308", "1.7e308"],
  ])("rejects invalid limits %j and %j", (min, max) => {
    expect(validateAxisRange(min, max).ok).toBe(false);
  });
});
