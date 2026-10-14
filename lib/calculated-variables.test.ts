import { describe, expect, it } from "vitest";
import { calculateVariables } from "./calculated-variables";
import { extractVariables, parseEquations } from "./math";

function calculate(source: string, knownValues: Record<string, number> | null = {}) {
  const equations = parseEquations(source);
  return calculateVariables(equations, extractVariables(equations), knownValues);
}

describe("calculable variables", () => {
  it("calculates from knowns and propagates through multiple equations", () => {
    expect(calculate("g=t+a\nF=g+9", { t: 2, a: 3 })).toEqual({ g: 5, F: 14 });
  });

  it("calculates a single remaining variable through nonlinear equations", () => {
    expect(calculate("g=sqrt(a)+2", { a: 9 })).toMatchObject({ g: expect.closeTo(5, 7) });
    expect(calculate("g^2=4")).toEqual({});
  });

  it("leaves variables unknown when an equation has multiple unresolved variables", () => {
    expect(calculate("x+y=10")).toEqual({});
    expect(calculate("x+y=10\nz=x+y")).toEqual({});
  });

  it("does not mark contradictory or non-unique deductions as calculated", () => {
    expect(calculate("g=t+a\ng=t+a+1", { t: 2, a: 3 })).toEqual({});
    expect(calculate("g^2=4")).toEqual({});
  });

  it("does not calculate around an invalid known value", () => {
    expect(calculate("g=t+a\nF=g+9", null)).toEqual({});
  });

  it("does not override variables explicitly marked known", () => {
    expect(calculate("g=t+a", { t: 2, a: 3, g: 20 })).toEqual({});
  });
});
