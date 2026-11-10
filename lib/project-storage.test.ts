import { describe, expect, it } from "vitest";
import { createEmptyBoardDocument, setEquationText, setKnown, setKnownValue, setStroke } from "./board-document";
import {
  createProjectFile,
  isProjectLibrary,
  parseProjectFile,
  serializeProjectFile,
} from "./project-storage";

describe("local project files", () => {
  it("exports and imports equations, known values, strokes, and editable annotations", () => {
    let document = setEquationText(createEmptyBoardDocument(), "Fx=10", "ipad");
    document = setKnown(setKnownValue(document, "Fx", "10", "ipad"), "Fx", true, "ipad");
    document = setStroke(
      document,
      "00000000-0000-4000-8000-000000000001",
      [{ x: 0.2, y: 0.4, pressure: 0.5 }, { x: 0.8, y: 0.4, pressure: 0.5 }],
      false,
      "ipad",
      { color: "red", mode: "dimension", label: "120 mm" },
    );
    const restored = parseProjectFile(serializeProjectFile("Axle", document));

    expect(restored.format).toBe("fbd-whiteboard-project");
    expect(restored.version).toBe(1);
    expect(restored.project.name).toBe("Axle");
    expect(restored.project.document.equationText.value).toBe("Fx=10");
    expect(restored.project.document.known.Fx.value).toBe(true);
    expect(restored.project.document.knownValues.Fx.value).toBe("10");
    expect(restored.project.document.strokes["00000000-0000-4000-8000-000000000001"]).toMatchObject({
      mode: "dimension",
      label: "120 mm",
      color: "red",
    });
  });

  it("rejects malformed, unsupported, or invalid project files without returning board data", () => {
    expect(() => parseProjectFile("{")).toThrow("not valid project JSON");
    expect(() => parseProjectFile(JSON.stringify({ format: "other", version: 1 }))).toThrow("not an FBD Whiteboard project");
    expect(() => parseProjectFile(JSON.stringify({ format: "fbd-whiteboard-project", version: 2 }))).toThrow("unsupported file version 2");
    expect(() => parseProjectFile(JSON.stringify({
      format: "fbd-whiteboard-project",
      version: 1,
      exportedAt: "2026-11-10T00:00:00.000Z",
      project: { name: "Bad data", document: { version: 1 } },
    }))).toThrow("invalid or unsupported board data");
    expect(() => parseProjectFile(JSON.stringify({
      format: "fbd-whiteboard-project",
      version: 1,
      exportedAt: "invalid date",
      project: { name: "Bad date", document: createEmptyBoardDocument() },
    }))).toThrow("invalid export date");
    expect(() => parseProjectFile("x".repeat(5_000_001))).toThrow("too large to import");
  });

  it("validates the local library and requires a real active project", () => {
    const project = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Axle",
      document: createEmptyBoardDocument(),
      updatedAt: "2026-11-10T00:00:00.000Z",
    };
    expect(isProjectLibrary({ version: 1, projects: [project], activeProjectId: project.id })).toBe(true);
    expect(isProjectLibrary({ version: 1, projects: [project], activeProjectId: "missing" })).toBe(false);
    expect(isProjectLibrary({
      version: 1,
      projects: [project, project],
      activeProjectId: project.id,
    })).toBe(false);
  });

  it("writes the portable file format version explicitly", () => {
    const file = createProjectFile("New board", createEmptyBoardDocument());
    expect(file).toMatchObject({ format: "fbd-whiteboard-project", version: 1 });
    expect(Number.isFinite(Date.parse(file.exportedAt))).toBe(true);
  });
});
