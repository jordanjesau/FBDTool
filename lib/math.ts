export type LinearEquation = {
  coefficients: Record<string, number>;
  constant: number;
  source: string;
};

export type SolveResult =
  | { ok: true; values: Record<string, number> }
  | { ok: false; reason: "non-square" | "inconsistent" | "non-unique" | "ill-conditioned"; message: string };

type Expression =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "unary"; operator: "+" | "-"; value: Expression }
  | { type: "binary"; operator: "+" | "-" | "*" | "/" | "^"; left: Expression; right: Expression };

type LinearForm = { coefficients: Map<string, number>; constant: number };
type Token = { kind: "number" | "identifier" | "operator"; value: string };

export class MathInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MathInputError";
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new MathInputError("Numbers must be finite.");
      tokens.push({ kind: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(rest);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const char = source[index];
    if ("+-*/^()".includes(char)) {
      tokens.push({ kind: "operator", value: char });
      index += 1;
      continue;
    }
    throw new MathInputError(`Unsupported character "${char}". Use standard symbols and explicit equation syntax.`);
  }
  if (tokens.length === 0) throw new MathInputError("Equation side cannot be empty.");
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expression {
    const expression = this.parseSum();
    if (this.index !== this.tokens.length) {
      throw new MathInputError(`Unexpected token "${this.tokens[this.index].value}".`);
    }
    return expression;
  }

  private parseSum(): Expression {
    let expression = this.parseProduct();
    while (this.peek("+") || this.peek("-")) {
      const operator = this.take().value as "+" | "-";
      expression = { type: "binary", operator, left: expression, right: this.parseProduct() };
    }
    return expression;
  }

  private parseProduct(): Expression {
    let expression = this.parseUnary();
    while (this.peek("*") || this.peek("/") || this.startsPrimary()) {
      if (this.peek("*") || this.peek("/")) {
        const operator = this.take().value as "*" | "/";
        expression = { type: "binary", operator, left: expression, right: this.parseUnary() };
      } else {
        expression = { type: "binary", operator: "*", left: expression, right: this.parseUnary() };
      }
    }
    return expression;
  }

  private parseUnary(): Expression {
    if (this.peek("+") || this.peek("-")) {
      const operator = this.take().value as "+" | "-";
      return { type: "unary", operator, value: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Expression {
    let expression = this.parsePrimary();
    if (this.peek("^")) {
      this.take();
      const right = this.parseUnary();
      expression = { type: "binary", operator: "^", left: expression, right };
    }
    return expression;
  }

  private parsePrimary(): Expression {
    const token = this.tokens[this.index];
    if (!token) throw new MathInputError("Expression ended unexpectedly.");
    if (token.kind === "number") {
      this.index += 1;
      return { type: "number", value: Number(token.value) };
    }
    if (token.kind === "identifier") {
      this.index += 1;
      return { type: "variable", name: token.value };
    }
    if (token.value === "(") {
      this.index += 1;
      const expression = this.parseSum();
      if (!this.peek(")")) throw new MathInputError("Missing closing parenthesis.");
      this.take();
      return expression;
    }
    throw new MathInputError(`Expected a number, variable, or parenthesis; received "${token.value}".`);
  }

  private startsPrimary(): boolean {
    const token = this.tokens[this.index];
    return token?.kind === "number" || token?.kind === "identifier" || token?.value === "(";
  }

  private peek(value: string): boolean {
    return this.tokens[this.index]?.value === value;
  }

  private take(): Token {
    return this.tokens[this.index++];
  }
}

function addForms(left: LinearForm, right: LinearForm, sign: number): LinearForm {
  const coefficients = new Map(left.coefficients);
  for (const [name, value] of right.coefficients) {
    coefficients.set(name, (coefficients.get(name) ?? 0) + sign * value);
  }
  return { coefficients, constant: left.constant + sign * right.constant };
}

function scaleForm(form: LinearForm, factor: number): LinearForm {
  return {
    coefficients: new Map([...form.coefficients].map(([name, value]) => [name, value * factor])),
    constant: form.constant * factor,
  };
}

function linearize(expression: Expression): LinearForm {
  if (expression.type === "number") return { coefficients: new Map(), constant: expression.value };
  if (expression.type === "variable") return { coefficients: new Map([[expression.name, 1]]), constant: 0 };
  if (expression.type === "unary") {
    return scaleForm(linearize(expression.value), expression.operator === "-" ? -1 : 1);
  }

  const left = linearize(expression.left);
  const right = linearize(expression.right);
  switch (expression.operator) {
    case "+":
      return addForms(left, right, 1);
    case "-":
      return addForms(left, right, -1);
    case "*":
      if (left.coefficients.size > 0 && right.coefficients.size > 0) {
        throw new MathInputError("Nonlinear multiplication is unsupported; a product may contain at most one variable expression.");
      }
      if (left.coefficients.size === 0) return scaleForm(right, left.constant);
      return scaleForm(left, right.constant);
    case "/":
      if (right.coefficients.size > 0) throw new MathInputError("Division by an expression containing variables is nonlinear and unsupported.");
      if (right.constant === 0) throw new MathInputError("Division by zero is undefined.");
      return scaleForm(left, 1 / right.constant);
    case "^":
      if (right.coefficients.size > 0) throw new MathInputError("Variable exponents are unsupported.");
      if (right.constant === 1) return left;
      if (right.constant === 0) return { coefficients: new Map(), constant: 1 };
      if (left.coefficients.size > 0) {
        throw new MathInputError("Powers of variables are nonlinear; only first powers are supported.");
      }
      if (left.constant === 0 && right.constant < 0) throw new MathInputError("Zero cannot be raised to a negative power.");
      return { coefficients: new Map(), constant: left.constant ** right.constant };
  }
}

export function parseEquation(source: string): LinearEquation {
  const separator = source.indexOf("=");
  if (separator < 0 || source.indexOf("=", separator + 1) >= 0) {
    throw new MathInputError("Each equation must contain exactly one equals sign.");
  }
  const leftText = source.slice(0, separator);
  const rightText = source.slice(separator + 1);
  const left = linearize(new Parser(tokenize(leftText)).parse());
  const right = linearize(new Parser(tokenize(rightText)).parse());
  const result = addForms(left, right, -1);
  const coefficients: Record<string, number> = {};
  for (const [name, value] of result.coefficients) {
    if (!Number.isFinite(value)) throw new MathInputError("Equation coefficients must be finite.");
    coefficients[name] = value;
  }
  if (!Number.isFinite(result.constant)) throw new MathInputError("Equation constants must be finite.");
  return { coefficients, constant: result.constant, source: source.trim() };
}

export function parseEquations(source: string): LinearEquation[] {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new MathInputError("Add at least one equation.");
  return lines.map((line, index) => {
    try {
      return parseEquation(line);
    } catch (error) {
      if (error instanceof MathInputError) {
        throw new MathInputError(`Equation ${index + 1}: ${error.message}`);
      }
      throw error;
    }
  });
}

export function extractVariables(equations: LinearEquation[]): string[] {
  return [...new Set(equations.flatMap((equation) => Object.keys(equation.coefficients)))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function solveSystem(
  equations: LinearEquation[],
  unknowns: string[],
  knownValues: Record<string, number> = {},
): SolveResult {
  if (equations.length < unknowns.length) {
    return {
      ok: false,
      reason: "non-square",
      message: `A unique solution needs at least as many independent equations as unknowns: ${equations.length} equation(s), ${unknowns.length} unknown(s).`,
    };
  }
  const matrix = equations.map((equation) => {
    const row = unknowns.map((name) => equation.coefficients[name] ?? 0);
    let rightHandSide = -equation.constant;
    for (const [name, value] of Object.entries(knownValues)) {
      if (!Number.isFinite(value)) {
        return { row, rightHandSide: Number.NaN };
      }
      if (!unknowns.includes(name)) rightHandSide -= (equation.coefficients[name] ?? 0) * value;
    }
    return { row, rightHandSide };
  });
  if (matrix.some(({ row, rightHandSide }) => !Number.isFinite(rightHandSide) || row.some((value) => !Number.isFinite(value)))) {
    return { ok: false, reason: "ill-conditioned", message: "The system contains non-finite values and cannot be solved safely." };
  }

  for (const entry of matrix) {
    const rowScale = Math.max(0, ...entry.row.map(Math.abs));
    if (rowScale > 0) {
      entry.row = entry.row.map((value) => value / rowScale);
      entry.rightHandSide /= rowScale;
    }
  }
  if (matrix.some(({ row, rightHandSide }) =>
    !Number.isFinite(rightHandSide) || row.some((value) => !Number.isFinite(value)),
  )) {
    return { ok: false, reason: "ill-conditioned", message: "Scaling the system produced non-finite values; rescale the equations." };
  }
  const scale = Math.max(0, ...matrix.flatMap(({ row }) => row.map(Math.abs)));
  const rightHandSideScale = Math.max(1, ...matrix.map(({ rightHandSide }) => Math.abs(rightHandSide)));
  const rightHandSideTolerance = Number.EPSILON * rightHandSideScale * Math.max(unknowns.length, equations.length, 1) * 16;
  if (scale === 0) {
    const inconsistent = matrix.some(({ rightHandSide }) => Math.abs(rightHandSide) > rightHandSideTolerance);
    return inconsistent
      ? { ok: false, reason: "inconsistent", message: "The equations contradict one another; no solution exists." }
      : unknowns.length === 0
        ? { ok: true, values: {} }
        : { ok: false, reason: "non-unique", message: "The equations do not constrain any unknown variables." };
  }
  let illConditioned = false;
  let rank = 0;
  const pivots: number[] = [];
  const rankTolerance = Number.EPSILON * scale * Math.max(unknowns.length, equations.length) * 16;
  for (let column = 0; column < unknowns.length && rank < matrix.length; column += 1) {
    let pivotRow = rank;
    for (let row = rank + 1; row < matrix.length; row += 1) {
      if (Math.abs(matrix[row].row[column]) > Math.abs(matrix[pivotRow].row[column])) pivotRow = row;
    }
    const pivot = Math.abs(matrix[pivotRow].row[column]);
    if (pivot <= rankTolerance) continue;
    if (pivot < scale * 1e-10) illConditioned = true;
    [matrix[rank], matrix[pivotRow]] = [matrix[pivotRow], matrix[rank]];
    const pivotValue = matrix[rank].row[column];
    for (let row = rank + 1; row < matrix.length; row += 1) {
      const factor = matrix[row].row[column] / pivotValue;
      for (let entry = column; entry < unknowns.length; entry += 1) {
        matrix[row].row[entry] -= factor * matrix[rank].row[entry];
      }
      matrix[row].rightHandSide -= factor * matrix[rank].rightHandSide;
    }
    pivots.push(column);
    rank += 1;
  }
  const inconsistent = matrix.slice(rank).some(({ row, rightHandSide }) =>
    row.every((value) => Math.abs(value) <= rankTolerance)
    && Math.abs(rightHandSide) > rightHandSideTolerance,
  );
  if (inconsistent) {
    return { ok: false, reason: "inconsistent", message: "The equations contradict one another; no solution exists." };
  }
  if (matrix.some(({ row, rightHandSide }) =>
    !Number.isFinite(rightHandSide) || row.some((value) => !Number.isFinite(value)),
  )) {
    return { ok: false, reason: "ill-conditioned", message: "Solving the system produced non-finite values; rescale the equations." };
  }
  if (rank < unknowns.length) {
    return { ok: false, reason: "non-unique", message: "The equations do not determine a unique value for every unknown." };
  }
  if (illConditioned) {
    return { ok: false, reason: "ill-conditioned", message: "The system is numerically ill-conditioned; improve equation scaling before solving." };
  }

  const values: Record<string, number> = {};
  for (let row = rank - 1; row >= 0; row -= 1) {
    const column = pivots[row];
    let value = matrix[row].rightHandSide;
    for (let next = column + 1; next < unknowns.length; next += 1) {
      value -= matrix[row].row[next] * values[unknowns[next]];
    }
    value /= matrix[row].row[column];
    if (!Number.isFinite(value)) {
      return { ok: false, reason: "ill-conditioned", message: "The solution exceeded the numeric range and cannot be displayed safely." };
    }
    values[unknowns[column]] = value;
  }
  return { ok: true, values };
}
