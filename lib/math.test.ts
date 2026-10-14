import { describe, expect, it } from "vitest";
import { extractVariables, MathInputError, parseEquation, parseEquations, solveSystem } from "./math";

describe("equation parsing", () => {
  it("parses explicit and implicit multiplication and collects consistent variables", () => {
    const equations = parseEquations("F = 2a\nF - 3*x = 0\nx-x=0");
    expect(extractVariables(equations)).toEqual(["F", "a", "x"]);
    expect(equations[0].linearForm).toMatchObject({ coefficients: { F: 1, a: -2 }, constant: 0 });
    expect(equations[2].linearForm?.coefficients).toHaveProperty("x", 0);
  });

  it("keeps adjacent letters in one identifier", () => {
    const equation = parseEquation("Fx*2+19=0");
    expect(extractVariables([equation])).toEqual(["Fx"]);
    expect(equation.linearForm).toMatchObject({ coefficients: { Fx: 2 }, constant: 19 });
  });

  it("reduces both sides into a linear equation", () => {
    expect(parseEquation("2 * (x + 3) = 10").linearForm).toMatchObject({
      coefficients: { x: 2 },
      constant: -4,
    });
  });

  it.each(["x == 1", "sqrt(x = 1"])("rejects malformed equation %s", (input) => {
    expect(() => parseEquation(input)).toThrow(MathInputError);
  });

  it("parses nonlinear products, powers, and math functions without evaluating code", () => {
    expect(extractVariables(parseEquations("x*y=2\nsqrt(x)=y\nexp(y)=4\n|x-y|=1"))).toEqual(["x", "y"]);
    expect(parseEquation("abs(-3)=3").linearForm?.constant).toBe(0);
    expect(() => parseEquation("unknown(x)=1")).toThrow('Unsupported function "unknown".');
  });

  it("reports the source line for invalid equation input", () => {
    expect(() => parseEquations("x=2\ny==4")).toThrow("Equation 2:");
  });
});

describe("linear-system solving", () => {
  it("solves a square system with known values substituted", () => {
    const equations = parseEquations("x + y = 10\n2*x - y = 2");
    expect(solveSystem(equations, ["x", "y"])).toEqual({ ok: true, values: { y: 6, x: 4 } });
  });

  it("rejects non-square, contradictory, underdetermined, and ill-conditioned systems", () => {
    expect(solveSystem(parseEquations("x+y=1"), ["x", "y"])).toMatchObject({ ok: false, reason: "non-square" });
    expect(solveSystem(parseEquations("x=1\nx=2"), ["x", "y"])).toMatchObject({ ok: false, reason: "inconsistent" });
    expect(solveSystem(parseEquations("x+y=1\n2*x+2*y=2"), ["x", "y"])).toMatchObject({ ok: false, reason: "non-unique" });
    expect(solveSystem(parseEquations("x+y=2\nx+1.000000000001*y=2.000000000001"), ["x", "y"]))
      .toMatchObject({ ok: false, reason: "ill-conditioned" });
  });

  it("substitutes editable known values", () => {
    const equations = parseEquations("x + y = 8\nx - y = 2");
    expect(solveSystem(equations, ["x"], { y: 3 })).toEqual({ ok: true, values: { x: 5 } });
  });

  it("scales equations before solving and checks extra equations for consistency", () => {
    expect(solveSystem(parseEquations("1000000000000*x + 1000000000000*y = 3000000000000\nx-y=1"), ["x", "y"]))
      .toEqual({ ok: true, values: { y: 1, x: 2 } });
    expect(solveSystem(parseEquations("x+y=4\nx+y=5"), ["x"], { y: 1 }))
      .toMatchObject({ ok: false, reason: "inconsistent" });
  });

  it("solves nonlinear products, powers, roots, and exponentials numerically", () => {
    expect(solveSystem(parseEquations("x*y=6\nx+y=5"), ["x", "y"])).toMatchObject({
      ok: false,
      reason: "non-unique",
    });
    expect(solveSystem(parseEquations("sqrt(x)=3"), ["x"])).toMatchObject({ ok: true, values: { x: expect.closeTo(9, 6) } });
    expect(solveSystem(parseEquations("exp(x)=2"), ["x"])).toMatchObject({ ok: true, values: { x: expect.closeTo(Math.log(2), 6) } });
    expect(solveSystem(parseEquations("x^2=4\nx=2"), ["x"])).toMatchObject({ ok: true, values: { x: expect.closeTo(2, 6) } });
  });

  it("interprets trigonometric functions in degrees, including inverse functions", () => {
    expect(solveSystem(parseEquations("sin(30)=y"), ["y"])).toMatchObject({ ok: true, values: { y: expect.closeTo(0.5, 8) } });
    expect(solveSystem(parseEquations("asin(0.5)=angle"), ["angle"])).toMatchObject({ ok: true, values: { angle: expect.closeTo(30, 8) } });
    expect(solveSystem(parseEquations("sin(x)=y"), ["y"], { x: 30 })).toMatchObject({ ok: true, values: { y: expect.closeTo(0.5, 8) } });
    expect(solveSystem(parseEquations("|x|=2\nx=2"), ["x"])).toMatchObject({ ok: true, values: { x: expect.closeTo(2, 6) } });
  });

  it("reports multiple nonlinear roots rather than choosing one arbitrarily", () => {
    expect(solveSystem(parseEquations("x^2=4"), ["x"])).toMatchObject({ ok: false, reason: "non-unique" });
  });

  it("checks nonlinear equations when all variables are marked known", () => {
    const equations = parseEquations("x^2=4");
    expect(solveSystem(equations, [], { x: 2 })).toEqual({ ok: true, values: {} });
    expect(solveSystem(equations, [], { x: 3 })).toMatchObject({ ok: false, reason: "inconsistent" });
  });
});
