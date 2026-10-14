export type LinearEquation = {
  source: string;
  expression: Expression;
  linearForm: { coefficients: Record<string, number>; constant: number } | null;
};

export type SolveResult =
  | { ok: true; values: Record<string, number> }
  | { ok: false; reason: "non-square" | "inconsistent" | "non-unique" | "ill-conditioned" | "no-convergence"; message: string };

type Expression =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "function"; name: string; argument: Expression }
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

class NonlinearExpressionError extends MathInputError {}

const mathFunctions = new Set(["sqrt", "exp", "ln", "log", "log10", "sin", "cos", "tan", "asin", "acos", "atan", "abs", "sinh", "cosh", "tanh"]);

function applyMathFunction(name: string, value: number): number {
  switch (name) {
    case "sqrt": return Math.sqrt(value);
    case "exp": return Math.exp(value);
    case "ln":
    case "log": return Math.log(value);
    case "log10": return Math.log10(value);
    case "sin": return Math.sin(value);
    case "cos": return Math.cos(value);
    case "tan": return Math.tan(value);
    case "asin": return Math.asin(value);
    case "acos": return Math.acos(value);
    case "atan": return Math.atan(value);
    case "abs": return Math.abs(value);
    case "sinh": return Math.sinh(value);
    case "cosh": return Math.cosh(value);
    case "tanh": return Math.tanh(value);
    default: throw new MathInputError(`Unsupported function "${name}".`);
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
      if (this.peek("(")) {
        if (!mathFunctions.has(token.value)) throw new MathInputError(`Unsupported function "${token.value}".`);
        this.take();
        const argument = this.parseSum();
        if (!this.peek(")")) throw new MathInputError(`Missing closing parenthesis for ${token.value}().`);
        this.take();
        return { type: "function", name: token.value, argument };
      }
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
  if (expression.type === "function") {
    const argument = linearize(expression.argument);
    if (argument.coefficients.size > 0) throw new NonlinearExpressionError("A function of a variable requires nonlinear solving.");
    const value = applyMathFunction(expression.name, argument.constant);
    if (!Number.isFinite(value)) throw new MathInputError(`${expression.name}() is undefined for this value.`);
    return { coefficients: new Map(), constant: value };
  }
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
        throw new NonlinearExpressionError("Multiplying variable expressions requires nonlinear solving.");
      }
      if (left.coefficients.size === 0) return scaleForm(right, left.constant);
      return scaleForm(left, right.constant);
    case "/":
      if (right.coefficients.size > 0) throw new NonlinearExpressionError("Dividing by a variable expression requires nonlinear solving.");
      if (right.constant === 0) throw new MathInputError("Division by zero is undefined.");
      return scaleForm(left, 1 / right.constant);
    case "^":
      if (right.coefficients.size > 0) throw new NonlinearExpressionError("A variable exponent requires nonlinear solving.");
      if (right.constant === 1) return left;
      if (right.constant === 0) return { coefficients: new Map(), constant: 1 };
      if (left.coefficients.size > 0) {
        throw new NonlinearExpressionError("Powers of variables require nonlinear solving.");
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
  const left = new Parser(tokenize(leftText)).parse();
  const right = new Parser(tokenize(rightText)).parse();
  const expression: Expression = { type: "binary", operator: "-", left, right };
  let linearForm: LinearEquation["linearForm"] = null;
  try {
    const result = linearize(expression);
    const coefficients: Record<string, number> = {};
    for (const [name, value] of result.coefficients) {
      if (!Number.isFinite(value)) throw new MathInputError("Equation coefficients must be finite.");
      coefficients[name] = value;
    }
    if (!Number.isFinite(result.constant)) throw new MathInputError("Equation constants must be finite.");
    linearForm = { coefficients, constant: result.constant };
  } catch (error) {
    if (!(error instanceof NonlinearExpressionError)) throw error;
  }
  return { expression, linearForm, source: source.trim() };
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
  const names = new Set<string>();
  const visit = (expression: Expression) => {
    if (expression.type === "variable") names.add(expression.name);
    else if (expression.type === "function") visit(expression.argument);
    else if (expression.type === "unary") visit(expression.value);
    else if (expression.type === "binary") {
      visit(expression.left);
      visit(expression.right);
    }
  };
  equations.forEach((equation) => visit(equation.expression));
  return [...names]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function solveLinearSystem(
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
    const row = unknowns.map((name) => equation.linearForm?.coefficients[name] ?? 0);
    let rightHandSide = -(equation.linearForm?.constant ?? 0);
    for (const [name, value] of Object.entries(knownValues)) {
      if (!Number.isFinite(value)) {
        return { row, rightHandSide: Number.NaN };
      }
      if (!unknowns.includes(name)) rightHandSide -= (equation.linearForm?.coefficients[name] ?? 0) * value;
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

function evaluate(expression: Expression, values: Record<string, number>): number {
  switch (expression.type) {
    case "number": return expression.value;
    case "variable": return values[expression.name] ?? Number.NaN;
    case "function": return applyMathFunction(expression.name, evaluate(expression.argument, values));
    case "unary": {
      const value = evaluate(expression.value, values);
      return expression.operator === "-" ? -value : value;
    }
    case "binary": {
      const left = evaluate(expression.left, values);
      const right = evaluate(expression.right, values);
      switch (expression.operator) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return left / right;
        case "^": return left ** right;
      }
    }
  }
}

function solveDenseSystem(matrix: number[][], rightHandSide: number[]): number[] | null {
  const size = rightHandSide.length;
  const rows = matrix.map((row, index) => [...row, rightHandSide[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivotRow][column])) pivotRow = row;
    }
    const pivot = rows[pivotRow][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-24) return null;
    [rows[column], rows[pivotRow]] = [rows[pivotRow], rows[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = rows[row][column] / rows[column][column];
      for (let entry = column; entry <= size; entry += 1) rows[row][entry] -= factor * rows[column][entry];
    }
  }
  const solution = Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = rows[row][size];
    for (let column = row + 1; column < size; column += 1) value -= rows[row][column] * solution[column];
    solution[row] = value / rows[row][row];
    if (!Number.isFinite(solution[row])) return null;
  }
  return solution;
}

function solveNonlinearSystem(
  equations: LinearEquation[],
  unknowns: string[],
  knownValues: Record<string, number>,
): SolveResult {
  if (equations.length < unknowns.length) {
    return {
      ok: false,
      reason: "non-square",
      message: `A unique solution needs at least as many independent equations as unknowns: ${equations.length} equation(s), ${unknowns.length} unknown(s).`,
    };
  }
  if (Object.values(knownValues).some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: "ill-conditioned", message: "Known values must be finite numbers." };
  }
  if (unknowns.length === 0) {
    const residuals = equations.map(({ expression }) => evaluate(expression, knownValues));
    if (residuals.some((value) => !Number.isFinite(value))) {
      return { ok: false, reason: "no-convergence", message: "A nonlinear expression is undefined for the supplied known values." };
    }
    return residuals.every((value) => Math.abs(value) <= 1e-8)
      ? { ok: true, values: {} }
      : { ok: false, reason: "inconsistent", message: "The equations contradict the supplied known values." };
  }
  const residualsAt = (point: number[]): number[] | null => {
    const values = { ...knownValues };
    unknowns.forEach((name, index) => { values[name] = point[index]; });
    const residuals = equations.map(({ expression }) => evaluate(expression, values));
    return residuals.every(Number.isFinite) ? residuals : null;
  };
  const seeds: number[][] = [
    Array(unknowns.length).fill(0),
    Array(unknowns.length).fill(1),
    Array(unknowns.length).fill(-1),
    Array(unknowns.length).fill(10),
    Array(unknowns.length).fill(-10),
  ];
  for (let index = 0; index < unknowns.length && index < 18; index += 1) {
    for (const value of [1, -1]) {
      const seed = Array(unknowns.length).fill(0);
      seed[index] = value;
      seeds.push(seed);
    }
  }
  const startingPoints = seeds
    .map((point) => ({ point, residuals: residualsAt(point) }))
    .filter((start): start is { point: number[]; residuals: number[] } => start.residuals !== null);
  if (startingPoints.length === 0) {
    return { ok: false, reason: "no-convergence", message: "The nonlinear expressions are undefined at all solver starting points. Check the function domains and equation scale." };
  }
  const scales = startingPoints[0].residuals.map((residual) => Math.max(1, Math.abs(residual)));
  const normalized = (residuals: number[]) => residuals.map((residual, index) => residual / scales[index]);
  const solutions: number[][] = [];
  let illConditioned = false;

  for (const start of startingPoints) {
    let point = [...start.point];
    const initialResiduals = start.residuals;
    let rawResiduals = initialResiduals;
    let residuals = normalized(initialResiduals);
    let cost = residuals.reduce((sum, residual) => sum + residual * residual, 0);
    let damping = 1e-3;
    let converged = Math.sqrt(cost / Math.max(1, equations.length)) < 1e-8;

    for (let iteration = 0; iteration < 140 && !converged; iteration += 1) {
      const jacobian = Array.from({ length: equations.length }, () => Array<number>(unknowns.length).fill(0));
      let validJacobian = true;
      for (let column = 0; column < unknowns.length; column += 1) {
        const step = 1e-5 * (1 + Math.abs(point[column]));
        const plus = [...point];
        const minus = [...point];
        plus[column] += step;
        minus[column] -= step;
        const plusResiduals = residualsAt(plus);
        const minusResiduals = residualsAt(minus);
        if (plusResiduals && minusResiduals) {
          for (let row = 0; row < equations.length; row += 1) {
            jacobian[row][column] = (plusResiduals[row] - minusResiduals[row]) / (2 * step * scales[row]);
          }
        } else if (plusResiduals) {
          for (let row = 0; row < equations.length; row += 1) {
            jacobian[row][column] = (plusResiduals[row] - rawResiduals[row]) / (step * scales[row]);
          }
        } else if (minusResiduals) {
          for (let row = 0; row < equations.length; row += 1) {
            jacobian[row][column] = (rawResiduals[row] - minusResiduals[row]) / (step * scales[row]);
          }
        } else {
          validJacobian = false;
          break;
        }
      }
      if (!validJacobian || jacobian.some((row) => row.some((value) => !Number.isFinite(value)))) {
        illConditioned = true;
        break;
      }

      const normal = Array.from({ length: unknowns.length }, () => Array<number>(unknowns.length).fill(0));
      const gradient = Array<number>(unknowns.length).fill(0);
      for (let row = 0; row < equations.length; row += 1) {
        for (let column = 0; column < unknowns.length; column += 1) {
          gradient[column] += jacobian[row][column] * residuals[row];
          for (let other = 0; other < unknowns.length; other += 1) {
            normal[column][other] += jacobian[row][column] * jacobian[row][other];
          }
        }
      }
      for (let diagonal = 0; diagonal < unknowns.length; diagonal += 1) {
        normal[diagonal][diagonal] += damping * Math.max(1, normal[diagonal][diagonal]);
      }
      const delta = solveDenseSystem(normal, gradient.map((value) => -value));
      if (!delta) {
        illConditioned = true;
        break;
      }

      let improved = false;
      for (const fraction of [1, 0.5, 0.25, 0.125, 0.0625, 0.03125]) {
        const candidate = point.map((value, index) => value + delta[index] * fraction);
        const candidateRaw = residualsAt(candidate);
        if (!candidateRaw) continue;
        const candidateResiduals = normalized(candidateRaw);
        const candidateCost = candidateResiduals.reduce((sum, value) => sum + value * value, 0);
        if (candidateCost < cost) {
          point = candidate;
          rawResiduals = candidateRaw;
          residuals = candidateResiduals;
          cost = candidateCost;
          damping = Math.max(1e-12, damping * 0.3);
          improved = true;
          converged = Math.sqrt(cost / Math.max(1, equations.length)) < 1e-8;
          break;
        }
      }
      if (!improved) {
        damping *= 10;
        if (damping > 1e12) break;
      }
    }

    if (converged && point.every(Number.isFinite)) {
      if (!solutions.some((solution) => solution.every((value, index) =>
        Math.abs(value - point[index]) <= 1e-5 * (1 + Math.abs(value)),
      ))) solutions.push(point);
    }
  }

  if (solutions.length > 1) {
    return { ok: false, reason: "non-unique", message: "The nonlinear system has multiple distinct solutions; add another constraint or a known value." };
  }
  if (solutions.length === 0) {
    return illConditioned
      ? { ok: false, reason: "ill-conditioned", message: "The nonlinear solver could not find a stable solution. Check equation scaling and function domains." }
      : { ok: false, reason: "no-convergence", message: "No solution converged from the solver's starting points. Check the equations, function domains, and initial scale." };
  }
  return {
    ok: true,
    values: Object.fromEntries(unknowns.map((name, index) => [name, solutions[0][index]])),
  };
}

export function solveSystem(
  equations: LinearEquation[],
  unknowns: string[],
  knownValues: Record<string, number> = {},
): SolveResult {
  return equations.every((equation) => equation.linearForm !== null)
    ? solveLinearSystem(equations, unknowns, knownValues)
    : solveNonlinearSystem(equations, unknowns, knownValues);
}
