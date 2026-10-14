import { extractVariables, LinearEquation, solveSystem } from "./math";

export function calculateVariables(
  equations: LinearEquation[],
  variables: string[],
  knownValues: Record<string, number> | null,
): Record<string, number> {
  if (knownValues === null) return {};

  const equationVariables = equations.map((equation) => extractVariables([equation]));
  const values = { ...knownValues };
  const calculated: Record<string, number> = {};

  let changed = true;
  while (changed) {
    changed = false;
    for (const name of variables) {
      if (name in values) continue;
      const readyEquations = equations.filter((_, index) =>
        equationVariables[index].includes(name)
        && equationVariables[index].every((equationName) => equationName === name || equationName in values),
      );
      if (readyEquations.length === 0) continue;

      const result = solveSystem(readyEquations, [name], values);
      if (!result.ok || !Number.isFinite(result.values[name])) continue;

      values[name] = result.values[name];
      calculated[name] = result.values[name];
      changed = true;
    }
  }

  return calculated;
}
