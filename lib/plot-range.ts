export type AxisRange = { min: number; max: number };
export type AxisRangeValidation =
  | { ok: true; range: AxisRange }
  | { ok: false; message: string };

export function validateAxisRange(minText: string, maxText: string): AxisRangeValidation {
  if (!minText.trim() || !maxText.trim()) {
    return { ok: false, message: "Enter both axis limits." };
  }
  const min = Number(minText);
  const max = Number(maxText);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { ok: false, message: "Axis limits must be finite numbers." };
  }
  if (max <= min) {
    return { ok: false, message: "The maximum must be greater than the minimum." };
  }
  if (!Number.isFinite(max - min)) {
    return { ok: false, message: "The difference between axis limits is too large." };
  }
  return { ok: true, range: { min, max } };
}
