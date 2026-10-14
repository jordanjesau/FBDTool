export type Revision = { counter: number; clientId: string };
export type Versioned<T> = { value: T; revision: Revision };
export type BoardPoint = { x: number; y: number; pressure: number };
export type BoardPenColor = "navy" | "red" | "blue" | "green";
export type BoardStrokeMode = "freehand" | "straight" | "circle" | "arrow" | "eraser";
export type BoardStrokeStyle = { color: BoardPenColor; mode: BoardStrokeMode };
export type BoardStroke = {
  points: BoardPoint[];
  deleted: boolean;
  revision: Revision;
  created: Revision;
  color?: BoardPenColor;
  mode?: BoardStrokeMode;
};
export type BoardDocument = {
  version: 1;
  equationText: Versioned<string>;
  known: Record<string, Versioned<boolean>>;
  knownValues: Record<string, Versioned<string>>;
  strokes: Record<string, BoardStroke>;
};

const emptyRevision: Revision = { counter: 0, clientId: "" };

export function createEmptyBoardDocument(): BoardDocument {
  return {
    version: 1,
    equationText: { value: "", revision: emptyRevision },
    known: {},
    knownValues: {},
    strokes: {},
  };
}

export function compareRevision(left: Revision, right: Revision): number {
  return left.counter - right.counter || left.clientId.localeCompare(right.clientId);
}

function nextRevision(document: BoardDocument, clientId: string): Revision {
  const counters = [
    document.equationText.revision.counter,
    ...Object.values(document.known).map((field) => field.revision.counter),
    ...Object.values(document.knownValues).map((field) => field.revision.counter),
    ...Object.values(document.strokes).map((stroke) => stroke.revision.counter),
  ];
  return { counter: Math.max(0, ...counters) + 1, clientId };
}

export function setEquationText(document: BoardDocument, value: string, clientId: string): BoardDocument {
  return { ...document, equationText: { value, revision: nextRevision(document, clientId) } };
}

export function setKnown(document: BoardDocument, name: string, value: boolean, clientId: string): BoardDocument {
  return { ...document, known: { ...document.known, [name]: { value, revision: nextRevision(document, clientId) } } };
}

export function setKnownValue(document: BoardDocument, name: string, value: string, clientId: string): BoardDocument {
  return { ...document, knownValues: { ...document.knownValues, [name]: { value, revision: nextRevision(document, clientId) } } };
}

export function setStroke(
  document: BoardDocument,
  id: string,
  points: BoardPoint[],
  deleted: boolean,
  clientId: string,
  style?: BoardStrokeStyle,
): BoardDocument {
  const revision = nextRevision(document, clientId);
  const previous = document.strokes[id];
  return {
    ...document,
    strokes: {
      ...document.strokes,
      [id]: {
        points,
        deleted,
        revision,
        created: previous?.created ?? revision,
        ...((style?.color ?? previous?.color) ? { color: style?.color ?? previous?.color } : {}),
        ...((style?.mode ?? previous?.mode) ? { mode: style?.mode ?? previous?.mode } : {}),
      },
    },
  };
}

function newest<T>(left: Versioned<T>, right: Versioned<T>): Versioned<T> {
  return compareRevision(left.revision, right.revision) >= 0 ? left : right;
}

export function mergeBoardDocuments(local: BoardDocument, remote: BoardDocument): BoardDocument {
  let known: BoardDocument["known"] = { ...local.known };
  for (const [name, field] of Object.entries(remote.known)) {
    const existing = known[name];
    known = { ...known, [name]: existing ? newest(existing, field) : field };
  }
  let knownValues: BoardDocument["knownValues"] = { ...local.knownValues };
  for (const [name, field] of Object.entries(remote.knownValues)) {
    const existing = knownValues[name];
    knownValues = { ...knownValues, [name]: existing ? newest(existing, field) : field };
  }
  const strokes: BoardDocument["strokes"] = { ...local.strokes };
  for (const [id, stroke] of Object.entries(remote.strokes)) {
    const existing = strokes[id];
    if (!existing || compareRevision(stroke.revision, existing.revision) > 0) strokes[id] = stroke;
  }
  return {
    version: 1,
    equationText: newest(local.equationText, remote.equationText),
    known,
    knownValues,
    strokes,
  };
}

export function getVisibleStrokes(document: BoardDocument): Array<{ id: string; points: BoardPoint[]; created: Revision }> {
  return Object.entries(document.strokes)
    .filter(([, stroke]) => !stroke.deleted)
    .map(([id, stroke]) => ({ id, points: stroke.points, created: stroke.created }))
    .sort((left, right) => compareRevision(left.created, right.created));
}

export function isBoardDocument(value: unknown): value is BoardDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<BoardDocument>;
  const isRevision = (revision: unknown): revision is Revision =>
    !!revision
    && typeof revision === "object"
    && typeof (revision as Revision).counter === "number"
    && Number.isFinite((revision as Revision).counter)
    && (revision as Revision).counter >= 0
    && typeof (revision as Revision).clientId === "string"
    && (revision as Revision).clientId.length <= 100;
  const isVersioned = <T,>(field: unknown, isValue: (value: unknown) => value is T): field is Versioned<T> =>
    !!field
    && typeof field === "object"
    && isValue((field as Versioned<T>).value)
    && isRevision((field as Versioned<T>).revision);
  const isVersionedMap = <T,>(map: unknown, isValue: (value: unknown) => value is T): map is Record<string, Versioned<T>> =>
    !!map
    && typeof map === "object"
    && !Array.isArray(map)
    && Object.keys(map).length <= 1000
    && Object.values(map).every((field) => isVersioned(field, isValue));
  const isStrokeMap = (strokes: unknown): strokes is Record<string, BoardStroke> =>
    !!strokes
    && typeof strokes === "object"
    && !Array.isArray(strokes)
    && Object.keys(strokes).length <= 5000
    && Object.entries(strokes).every(([id, stroke]) => {
      if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) return false;
      if (!stroke || typeof stroke !== "object") return false;
      const record = stroke as BoardStroke;
      return typeof record.deleted === "boolean"
        && (record.color === undefined || ["navy", "red", "blue", "green"].includes(record.color))
        && (record.mode === undefined || ["freehand", "straight", "circle", "arrow", "eraser"].includes(record.mode))
        && Array.isArray(record.points)
        && record.points.length <= 12000
        && record.points.every((point) => !!point
          && Number.isFinite(point.x) && point.x >= 0 && point.x <= 1
          && Number.isFinite(point.y) && point.y >= 0 && point.y <= 1
          && Number.isFinite(point.pressure) && point.pressure >= 0 && point.pressure <= 1)
        && isRevision(record.revision)
        && isRevision(record.created);
    });
  return document.version === 1
    && isVersioned(document.equationText, (text): text is string => typeof text === "string" && text.length <= 100_000)
    && isVersionedMap(document.known, (known): known is boolean => typeof known === "boolean")
    && isVersionedMap(document.knownValues, (knownValue): knownValue is string => typeof knownValue === "string" && knownValue.length <= 1000)
    && isStrokeMap(document.strokes);
}
