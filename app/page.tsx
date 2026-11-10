"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent, type Ref, type RefObject } from "react";
import { extractVariables, LinearEquation, MathInputError, parseEquations, solveSystem, SolveResult } from "../lib/math";
import {
  BoardDocument,
  BoardPoint,
  BoardPenColor,
  BoardStroke,
  BoardStrokeMode,
  BoardStrokeStyle,
  compareRevision,
  createEmptyBoardDocument,
  setEquationText,
  setKnown,
  setKnownValue,
  setStroke,
} from "../lib/board-document";
import { boardSyncConfigured, readStoredBoard, useBoardSync } from "../lib/use-board-sync";
import { calculateVariables } from "../lib/calculated-variables";
import { validateAxisRange } from "../lib/plot-range";
import {
  activateLocalProject,
  createLocalProject,
  deleteLocalProject,
  loadProjectLibrary,
  parseProjectFile,
  ProjectLibrary,
  ProjectStorageMode,
  renameLocalProject,
  saveLocalProject,
  serializeProjectFile,
} from "../lib/project-storage";

type Point = BoardPoint;
type Sample = { driver: number; response: number };
type PlotBounds = { minX: number; maxX: number; minY: number; maxY: number };
type PlotBoundDraft = { [Key in keyof PlotBounds]: string };
type LastPlot = { samples: Sample[]; driver: string; response: string; bounds: PlotBounds };
type DrawingTool = BoardStrokeMode | "select";

const penColors: Array<{ id: BoardPenColor; label: string; value: string }> = [
  { id: "navy", label: "Charcoal", value: "#333333" },
  { id: "red", label: "Red", value: "#c2242a" },
  { id: "blue", label: "Slate", value: "#536675" },
  { id: "green", label: "Gold", value: "#806800" },
];

const penColorValues = Object.fromEntries(penColors.map((color) => [color.id, color.value])) as Record<BoardPenColor, string>;

function distanceFromSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  const ratio = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared));
  return Math.hypot(x - (x1 + ratio * (x2 - x1)), y - (y1 + ratio * (y2 - y1)));
}

function findStrokeAtPoint(
  point: Point,
  strokes: Record<string, BoardStroke>,
  width: number,
  height: number,
): string | null {
  const x = point.x * width;
  const y = point.y * height;
  let nearestId: string | null = null;
  let nearestDistance = 22;
  const orderedStrokes = Object.entries(strokes)
    .filter(([, stroke]) => !stroke.deleted && stroke.points.length > 0)
    .sort((left, right) => compareRevision(right[1].created, left[1].created));

  for (const [id, stroke] of orderedStrokes) {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    let distance = Number.POSITIVE_INFINITY;
    if (stroke.label) {
      const labelX = (stroke.mode === "dimension" ? (first.x + last.x) / 2 : first.x) * width;
      const labelY = (stroke.mode === "dimension" ? (first.y + last.y) / 2 : first.y) * height;
      const halfWidth = Math.max(18, stroke.label.length * 4.5);
      if (Math.abs(x - labelX) <= halfWidth + 8 && Math.abs(y - labelY) <= 16) distance = 0;
    }
    if (stroke.mode === "circle") {
      distance = Math.min(distance, Math.abs(
        Math.hypot(x - first.x * width, y - first.y * height)
        - Math.hypot((last.x - first.x) * width, (last.y - first.y) * height),
      ));
    } else {
      const points = stroke.mode === "straight" || stroke.mode === "arrow" || stroke.mode === "dimension"
        ? [first, last]
        : stroke.points;
      if (points.length === 1) {
        distance = Math.min(distance, Math.hypot(x - first.x * width, y - first.y * height));
      } else {
        for (let index = 1; index < points.length; index += 1) {
          distance = Math.min(distance, distanceFromSegment(
            x,
            y,
            points[index - 1].x * width,
            points[index - 1].y * height,
            points[index].x * width,
            points[index].y * height,
          ));
        }
      }
    }
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = id;
    }
  }
  return nearestId;
}

function DrawingPad({
  label,
  className = "",
  strokeRecords,
  onStrokeChange,
  reportCanvasRef,
  penColor,
  onPenColorChange,
  strokeMode,
  onStrokeModeChange,
}: {
  label: string;
  className?: string;
  strokeRecords: Record<string, BoardStroke>;
  onStrokeChange: (id: string, points: Point[], deleted: boolean, style?: BoardStrokeStyle) => void;
  reportCanvasRef: RefObject<HTMLCanvasElement | null>;
  penColor: BoardPenColor;
  onPenColorChange: (color: BoardPenColor) => void;
  strokeMode: DrawingTool;
  onStrokeModeChange: (mode: DrawingTool) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef(strokeRecords);
  const activeStrokeRef = useRef<{ id: string; points: Point[]; color: BoardPenColor; mode: BoardStrokeMode; label?: string } | null>(null);
  const selectedStrokeRef = useRef<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const lastSyncAtRef = useRef(0);
  const [hasMarks, setHasMarks] = useState(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<{ id: string; point: Point; isNew: boolean } | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    const strokes = [
      ...Object.entries(strokesRef.current)
        .filter(([, stroke]) => !stroke.deleted)
        .sort((left, right) => compareRevision(left[1].created, right[1].created))
        .map(([id, stroke]) => ({ id, stroke })),
      ...(activeStrokeRef.current ? [{ id: activeStrokeRef.current.id, stroke: activeStrokeRef.current }] : []),
    ];
    for (const { id, stroke } of strokes) {
      if (stroke.points.length === 0) continue;
      const first = stroke.points[0];
      const last = stroke.points[stroke.points.length - 1];
      const pixelRatio = window.devicePixelRatio || 1;
      const startX = first.x * canvas.width;
      const startY = first.y * canvas.height;
      const endX = last.x * canvas.width;
      const endY = last.y * canvas.height;
      context.beginPath();
      context.globalCompositeOperation = stroke.mode === "eraser" ? "destination-out" : "source-over";
      context.strokeStyle = penColorValues[stroke.color ?? "navy"];
      context.lineWidth = stroke.mode === "eraser"
        ? 24 * pixelRatio
        : Math.max(1.5, last.pressure * 3.2) * pixelRatio;
      if ((stroke.mode === "eraser" || stroke.mode === "freehand") && stroke.points.length === 1) {
        context.arc(startX, startY, context.lineWidth / 2, 0, Math.PI * 2);
      } else if (stroke.mode === "circle") {
        context.arc(startX, startY, Math.hypot(endX - startX, endY - startY), 0, Math.PI * 2);
      } else if (stroke.mode === "arrow") {
        const angle = Math.atan2(endY - startY, endX - startX);
        const length = Math.hypot(endX - startX, endY - startY);
        const headLength = Math.min(18 * pixelRatio, length * 0.4);
        const headAngle = Math.PI / 6;
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.lineTo(endX - headLength * Math.cos(angle - headAngle), endY - headLength * Math.sin(angle - headAngle));
        context.moveTo(endX, endY);
        context.lineTo(endX - headLength * Math.cos(angle + headAngle), endY - headLength * Math.sin(angle + headAngle));
      } else if (stroke.mode === "dimension") {
        const angle = Math.atan2(endY - startY, endX - startX);
        const length = Math.hypot(endX - startX, endY - startY);
        const headLength = Math.min(12 * pixelRatio, length * 0.3);
        const headAngle = Math.PI / 7;
        const normalX = -Math.sin(angle) * 7 * pixelRatio;
        const normalY = Math.cos(angle) * 7 * pixelRatio;
        context.moveTo(startX + normalX, startY + normalY);
        context.lineTo(startX - normalX, startY - normalY);
        context.moveTo(endX + normalX, endY + normalY);
        context.lineTo(endX - normalX, endY - normalY);
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.moveTo(startX, startY);
        context.lineTo(startX + headLength * Math.cos(angle - headAngle), startY + headLength * Math.sin(angle - headAngle));
        context.moveTo(startX, startY);
        context.lineTo(startX + headLength * Math.cos(angle + headAngle), startY + headLength * Math.sin(angle + headAngle));
        context.moveTo(endX, endY);
        context.lineTo(endX - headLength * Math.cos(angle - headAngle), endY - headLength * Math.sin(angle - headAngle));
        context.moveTo(endX, endY);
        context.lineTo(endX - headLength * Math.cos(angle + headAngle), endY - headLength * Math.sin(angle + headAngle));
      } else if (stroke.mode !== "text") {
        context.moveTo(startX, startY);
        const points = stroke.mode === "straight" ? [last] : stroke.points.slice(1);
        for (const point of points) {
          context.lineTo(point.x * canvas.width, point.y * canvas.height);
        }
      }
      if (stroke.mode !== "text") context.stroke();
      if (stroke.label) {
        const labelX = stroke.mode === "dimension" ? (startX + endX) / 2 : startX;
        const labelY = stroke.mode === "dimension" ? (startY + endY) / 2 : startY;
        context.save();
        context.font = `600 ${14 * pixelRatio}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        const labelWidth = context.measureText(stroke.label).width;
        context.fillStyle = "#efeeeb";
        context.fillRect(labelX - labelWidth / 2 - 5 * pixelRatio, labelY - 11 * pixelRatio, labelWidth + 10 * pixelRatio, 22 * pixelRatio);
        context.fillStyle = penColorValues[stroke.color ?? "navy"];
        context.fillText(stroke.label, labelX, labelY);
        context.restore();
      }
      if (selectedStrokeRef.current === id) {
        context.save();
        context.globalCompositeOperation = "source-over";
        context.strokeStyle = "#c2242a";
        context.lineWidth = 2 * pixelRatio;
        context.setLineDash([5 * pixelRatio, 4 * pixelRatio]);
        const xValues = stroke.points.map((point) => point.x * canvas.width);
        const yValues = stroke.points.map((point) => point.y * canvas.height);
        if (stroke.label) {
          context.font = `600 ${14 * pixelRatio}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
          const labelWidth = context.measureText(stroke.label).width;
          const labelX = stroke.mode === "dimension" ? (startX + endX) / 2 : startX;
          const labelY = stroke.mode === "dimension" ? (startY + endY) / 2 : startY;
          xValues.push(labelX - labelWidth / 2, labelX + labelWidth / 2);
          yValues.push(labelY - 12 * pixelRatio, labelY + 12 * pixelRatio);
        }
        const left = Math.min(...xValues) - 8 * pixelRatio;
        const top = Math.min(...yValues) - 8 * pixelRatio;
        const boxWidth = Math.max(24 * pixelRatio, Math.max(...xValues) - Math.min(...xValues) + 16 * pixelRatio);
        const boxHeight = Math.max(24 * pixelRatio, Math.max(...yValues) - Math.min(...yValues) + 16 * pixelRatio);
        context.strokeRect(left, top, boxWidth, boxHeight);
        context.restore();
      }
    }
  }, []);

  useEffect(() => {
    strokesRef.current = strokeRecords;
    const visibleStrokes = Object.values(strokeRecords).filter((stroke) => !stroke.deleted);
    setHasMarks(visibleStrokes.length > 0);
    redraw();
  }, [redraw, strokeRecords]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      redraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [redraw]);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      pressure: event.pressure || 0.5,
    };
  };

  const clear = useCallback(() => {
    const removedStrokes = Object.entries(strokesRef.current).filter(([, stroke]) => !stroke.deleted);
    strokesRef.current = Object.fromEntries(
      Object.entries(strokesRef.current).map(([id, stroke]) => [id, { ...stroke, deleted: true, points: [] }]),
    );
    for (const [id] of removedStrokes) onStrokeChange(id, [], true);
    activeStrokeRef.current = null;
    selectedStrokeRef.current = null;
    setSelectedStrokeId(null);
    setEditingLabel(null);
    setHasMarks(false);
    redraw();
  }, [onStrokeChange, redraw]);

  const undo = useCallback(() => {
    const last = Object.entries(strokesRef.current)
      .filter(([, stroke]) => !stroke.deleted)
      .sort((left, right) => compareRevision(right[1].created, left[1].created))[0];
    if (!last) return;
    const [id, stroke] = last;
    strokesRef.current = { ...strokesRef.current, [id]: { ...stroke, deleted: true, points: [] } };
    onStrokeChange(id, [], true);
    if (selectedStrokeRef.current === id) {
      selectedStrokeRef.current = null;
      setSelectedStrokeId(null);
    }
    if (editingLabel?.id === id) setEditingLabel(null);
    const hasVisibleStrokes = Object.values(strokesRef.current).some((item) => !item.deleted);
    setHasMarks(hasVisibleStrokes);
    redraw();
  }, [editingLabel?.id, onStrokeChange, redraw]);

  useEffect(() => {
    window.addEventListener("clear-sketch", clear);
    window.addEventListener("undo-sketch", undo);
    return () => {
      window.removeEventListener("clear-sketch", clear);
      window.removeEventListener("undo-sketch", undo);
    };
  }, [clear, undo]);

  useEffect(() => {
    if (editingLabel) labelInputRef.current?.focus();
  }, [editingLabel]);

  const saveLabel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = labelDraft.trim();
    if (!editingLabel || !label) return;
    const stroke = strokesRef.current[editingLabel.id];
    if (!stroke) return;
    const color = stroke.color ?? "navy";
    if (stroke.mode !== "dimension" && stroke.mode !== "text") return;
    const mode = stroke.mode;
    strokesRef.current = { ...strokesRef.current, [editingLabel.id]: { ...stroke, label } };
    onStrokeChange(editingLabel.id, stroke.points, false, { color, mode, label });
    selectedStrokeRef.current = editingLabel.id;
    setSelectedStrokeId(editingLabel.id);
    setEditingLabel(null);
    redraw();
  };

  const cancelLabel = () => {
    if (editingLabel?.isNew) {
      const stroke = strokesRef.current[editingLabel.id];
      if (stroke) {
        strokesRef.current = { ...strokesRef.current, [editingLabel.id]: { ...stroke, deleted: true, points: [] } };
        onStrokeChange(editingLabel.id, [], true);
      }
      selectedStrokeRef.current = null;
      setSelectedStrokeId(null);
      setHasMarks(Object.values(strokesRef.current).some((stroke) => !stroke.deleted));
    }
    setEditingLabel(null);
    redraw();
  };

  const deleteSelected = useCallback(() => {
    const id = selectedStrokeRef.current;
    const stroke = id ? strokesRef.current[id] : undefined;
    if (!id || !stroke || stroke.deleted) return;
    strokesRef.current = { ...strokesRef.current, [id]: { ...stroke, deleted: true, points: [] } };
    onStrokeChange(id, [], true);
    selectedStrokeRef.current = null;
    setSelectedStrokeId(null);
    setEditingLabel(null);
    setHasMarks(Object.values(strokesRef.current).some((item) => !item.deleted));
    redraw();
  }, [onStrokeChange, redraw]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      if (!selectedStrokeRef.current) return;
      event.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected]);

  const selectedStroke = selectedStrokeId ? strokeRecords[selectedStrokeId] : undefined;
  const selectedIsAnnotation = selectedStroke?.mode === "dimension" || selectedStroke?.mode === "text";

  return (
    <>
      <div className="sketch-toolbar pane-toolbar">
        <h1>Diagram</h1>
        <div className="sketch-actions">
          <div className="pen-colors" role="group" aria-label="Pen color">
            {penColors.map((color) => (
              <button
                key={color.id}
                className="pen-color-button"
                type="button"
                style={{ backgroundColor: color.value }}
                aria-label={`${color.label} pen`}
                aria-pressed={penColor === color.id}
                onClick={() => onPenColorChange(color.id)}
              />
            ))}
          </div>
          <div className="pen-modes" role="group" aria-label="Drawing tool">
            <button className="pen-mode-button" type="button" title="Freehand drawing" aria-label="Freehand drawing" aria-pressed={strokeMode === "freehand"} onClick={() => onStrokeModeChange("freehand")}>Free</button>
            <button className="pen-mode-button" type="button" title="Straight line" aria-label="Straight line" aria-pressed={strokeMode === "straight"} onClick={() => onStrokeModeChange("straight")}>Line</button>
            <button className="pen-mode-button" type="button" title="Circle" aria-label="Circle" aria-pressed={strokeMode === "circle"} onClick={() => onStrokeModeChange("circle")}>Circle</button>
            <button className="pen-mode-button" type="button" title="Arrow" aria-label="Arrow" aria-pressed={strokeMode === "arrow"} onClick={() => onStrokeModeChange("arrow")}>Arrow</button>
            <button className="pen-mode-button" type="button" title="Dimension" aria-label="Dimension" aria-pressed={strokeMode === "dimension"} onClick={() => onStrokeModeChange("dimension")}>Dim</button>
            <button className="pen-mode-button" type="button" title="Text box" aria-label="Text box" aria-pressed={strokeMode === "text"} onClick={() => onStrokeModeChange("text")}>Text</button>
            <button className="pen-mode-button" type="button" title="Select and edit marks" aria-label="Select and edit marks" aria-pressed={strokeMode === "select"} onClick={() => onStrokeModeChange("select")}>Select</button>
            <button className="pen-mode-button" type="button" title="Eraser" aria-label="Eraser" aria-pressed={strokeMode === "eraser"} onClick={() => onStrokeModeChange("eraser")}>Erase</button>
          </div>
          {selectedStroke && !selectedStroke.deleted && (
            <div className="selection-actions" role="group" aria-label="Selected mark actions">
              <span aria-live="polite">Mark selected</span>
              {selectedIsAnnotation && (
                <button className="quiet-button" type="button" onClick={() => {
                  const selectedId = selectedStrokeId;
                  if (!selectedId || selectedStroke.points.length === 0) return;
                  const first = selectedStroke.points[0];
                  const last = selectedStroke.points[selectedStroke.points.length - 1] ?? first;
                  setLabelDraft(selectedStroke.label ?? "");
                  setEditingLabel({
                    id: selectedId,
                    point: selectedStroke.mode === "dimension"
                      ? { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, pressure: 0.5 }
                      : first,
                    isNew: false,
                  });
                }}>Edit label</button>
              )}
              <button className="quiet-button" type="button" onClick={deleteSelected}>Delete selected</button>
            </div>
          )}
          <button className="quiet-button" type="button" disabled={!hasMarks} onClick={() => window.dispatchEvent(new Event("undo-sketch"))}>Undo</button>
          <button className="quiet-button" type="button" onClick={() => window.dispatchEvent(new Event("clear-sketch"))}>Clear</button>
        </div>
      </div>
      <div className={`pad-shell ${className}`}>
        <canvas
          ref={(canvas) => {
            canvasRef.current = canvas;
            reportCanvasRef.current = canvas;
          }}
          aria-label={label}
          className="drawing-canvas"
          onPointerDown={(event) => {
            event.preventDefault();
            if (event.button !== 0) return;
            if (strokeMode === "select") {
              const rect = event.currentTarget.getBoundingClientRect();
              const id = findStrokeAtPoint(pointFromEvent(event), strokesRef.current, rect.width, rect.height);
              selectedStrokeRef.current = id;
              setSelectedStrokeId(id);
              setEditingLabel(null);
              redraw();
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            activeStrokeRef.current = {
              id: crypto.randomUUID(),
              points: [pointFromEvent(event)],
              color: penColor,
              mode: strokeMode,
            };
            lastSyncAtRef.current = performance.now();
            redraw();
          }}
          onPointerMove={(event) => {
            const activeStroke = activeStrokeRef.current;
            if (!activeStroke) return;
            event.preventDefault();
            const point = pointFromEvent(event);
            if (activeStroke.mode === "straight" || activeStroke.mode === "dimension") {
              activeStroke.points = [activeStroke.points[0], point];
            } else if (activeStroke.mode !== "text") {
              activeStroke.points.push(point);
            }
            if (activeStroke.mode !== "dimension" && activeStroke.mode !== "text"
              && performance.now() - lastSyncAtRef.current >= 100) {
              const { id, points, color, mode } = activeStroke;
              onStrokeChange(id, [...points], false, { color, mode });
              lastSyncAtRef.current = performance.now();
            }
            redraw();
          }}
          onPointerUp={(event) => {
            const activeStroke = activeStrokeRef.current;
            if (!activeStroke) return;
            const endPoint = pointFromEvent(event);
            if (activeStroke.mode === "straight" || activeStroke.mode === "dimension") {
              activeStroke.points = [activeStroke.points[0], endPoint];
            } else if (activeStroke.mode !== "text") {
              const lastPoint = activeStroke.points[activeStroke.points.length - 1];
              if (lastPoint.x !== endPoint.x || lastPoint.y !== endPoint.y) activeStroke.points.push(endPoint);
            }
            const { id, points, color, mode } = activeStroke;
            if (mode === "dimension" || mode === "text") {
              const revision = { counter: Date.now(), clientId: id };
              const labelPoint = mode === "dimension"
                ? {
                  x: (points[0].x + points[points.length - 1].x) / 2,
                  y: (points[0].y + points[points.length - 1].y) / 2,
                  pressure: 0.5,
                }
                : points[0];
              onStrokeChange(id, [...points], false, { color, mode, label: "" });
              strokesRef.current = {
                ...strokesRef.current,
                [id]: { points, deleted: false, color, mode, label: "", revision, created: revision },
              };
              activeStrokeRef.current = null;
              selectedStrokeRef.current = id;
              setSelectedStrokeId(id);
              setLabelDraft("");
              setEditingLabel({ id, point: labelPoint, isNew: true });
              setHasMarks(true);
              redraw();
              return;
            }
            onStrokeChange(id, [...points], false, { color, mode });
            strokesRef.current = {
              ...strokesRef.current,
              [id]: {
                points,
                deleted: false,
                color,
                mode,
                revision: { counter: Date.now(), clientId: id },
                created: { counter: Date.now(), clientId: id },
              },
            };
            activeStrokeRef.current = null;
            setHasMarks(true);
            redraw();
          }}
          onPointerCancel={() => {
            const activeStroke = activeStrokeRef.current;
            if (!activeStroke) return;
            if (activeStroke.mode === "dimension" || activeStroke.mode === "text") {
              activeStrokeRef.current = null;
              redraw();
              return;
            }
            const { id, points, color, mode } = activeStroke;
            onStrokeChange(id, [...points], false, { color, mode });
            strokesRef.current = {
              ...strokesRef.current,
              [id]: {
                points,
                deleted: false,
                color,
                mode,
                revision: { counter: Date.now(), clientId: id },
                created: { counter: Date.now(), clientId: id },
              },
            };
            activeStrokeRef.current = null;
            setHasMarks(true);
            redraw();
          }}
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
          onLostPointerCapture={() => {
            if (activeStrokeRef.current) {
              const { id, points, color, mode } = activeStrokeRef.current;
              if (mode === "dimension" || mode === "text") {
                activeStrokeRef.current = null;
                redraw();
                return;
              }
              onStrokeChange(id, [...points], false, { color, mode });
              strokesRef.current = {
                ...strokesRef.current,
                [id]: {
                  points,
                  deleted: false,
                  color,
                  mode,
                  revision: { counter: Date.now(), clientId: id },
                  created: { counter: Date.now(), clientId: id },
                },
              };
              activeStrokeRef.current = null;
              setHasMarks(true);
              redraw();
            }
          }}
        />
        {!hasMarks && <div className="pad-placeholder" aria-hidden="true">Write or draw here with Apple Pencil</div>}
        {editingLabel && (
          <form
            className="annotation-editor"
            style={{
              left: `${Math.max(20, Math.min(80, editingLabel.point.x * 100))}%`,
              top: `${editingLabel.point.y * 100}%`,
              transform: editingLabel.point.y < 0.25 ? "translate(-50%, 10px)" : undefined,
            }}
            onSubmit={saveLabel}
          >
            <label className="sr-only" htmlFor="annotation-label">
              {strokesRef.current[editingLabel.id]?.mode === "dimension" ? "Dimension value" : "Text label"}
            </label>
            <input
              ref={labelInputRef}
              id="annotation-label"
              autoComplete="off"
              maxLength={strokesRef.current[editingLabel.id]?.mode === "dimension" ? 40 : 120}
              inputMode={strokesRef.current[editingLabel.id]?.mode === "dimension" ? "decimal" : "text"}
              placeholder={strokesRef.current[editingLabel.id]?.mode === "dimension" ? "Enter dimension" : "Enter label"}
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              required
            />
            <button className="solve-button" type="submit" disabled={!labelDraft.trim()}>Save</button>
            <button className="quiet-button" type="button" onClick={cancelLabel}>Cancel</button>
          </form>
        )}
      </div>
    </>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 }).format(value);
}

function axisTicks(min: number, max: number) {
  const span = max - min;
  const roughStep = span / 5;
  if (!Number.isFinite(roughStep) || roughStep <= 0) return { values: [] };
  const rawMagnitude = 10 ** Math.floor(Math.log10(roughStep));
  const magnitude = Number.isFinite(rawMagnitude) && rawMagnitude > 0 ? rawMagnitude : roughStep;
  const fraction = roughStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * magnitude;
  if (!Number.isFinite(step) || step <= 0) return { values: [] };
  const firstIndex = Math.ceil(min / step);
  const lastIndex = Math.floor(max / step);
  if (!Number.isSafeInteger(firstIndex) || !Number.isSafeInteger(lastIndex)) return { values: [] };
  const count = Math.min(20, Math.max(0, lastIndex - firstIndex + 1));
  return { values: Array.from({ length: count }, (_, index) => (firstIndex + index) * step) };
}

function HighlightedEquation({ equation, variables, known, calculated }: {
  equation: string;
  variables: string[];
  known: Record<string, boolean>;
  calculated: Record<string, number>;
}) {
  const names = [...variables].sort((a, b) => b.length - a.length);
  const regex = names.length ? new RegExp(`(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gu") : null;
  const parts = regex ? equation.split(regex) : [equation];
  return (
    <code className="highlighted-equation">
      {parts.map((part, index) => variables.includes(part)
        ? <span className={known[part] ? "known-text" : part in calculated ? "calculated-text" : "unknown-text"} key={`${part}-${index}`}>{part}</span>
        : <span key={`text-${index}`}>{part}</span>)}
    </code>
  );
}

function buildSamples(
  equations: LinearEquation[],
  unknowns: string[],
  knownValues: Record<string, number>,
  driver: string,
  response: string,
  start: number,
  end: number,
  count: number,
): { samples?: Sample[]; error?: string } {
  const samples: Sample[] = [];
  for (let index = 0; index < count; index += 1) {
    const driverValue = start + ((end - start) * index) / (count - 1);
    const result: SolveResult = solveSystem(
      equations,
      unknowns.filter((name) => name !== driver),
      { ...knownValues, [driver]: driverValue },
    );
    if (!result.ok) return { error: `Could not solve at ${driver} = ${formatNumber(driverValue)}: ${result.message}` };
    const responseValue = result.values[response];
    if (!Number.isFinite(responseValue)) {
      return { error: `The selected response variable "${response}" is not an unknown in the remaining system.` };
    }
    samples.push({ driver: driverValue, response: responseValue });
  }
  return { samples };
}

function defaultPlotBounds(samples: Sample[]): PlotBounds | null {
  const minX = samples[0]?.driver;
  const maxX = samples[samples.length - 1]?.driver;
  const responses = samples.map((sample) => sample.response);
  const rawMinY = Math.min(...responses);
  const rawMaxY = Math.max(...responses);
  const responseSpan = rawMaxY - rawMinY;
  if (minX === undefined || maxX === undefined || !Number.isFinite(responseSpan)) return null;
  const yPadding = responseSpan === 0 ? Math.max(1, Math.abs(rawMinY) * 0.05) : responseSpan * 0.05;
  const bounds = { minX, maxX, minY: rawMinY - yPadding, maxY: rawMaxY + yPadding };
  const xRange = validateAxisRange(String(bounds.minX), String(bounds.maxX));
  const yRange = validateAxisRange(String(bounds.minY), String(bounds.maxY));
  if (!xRange.ok || !yRange.ok) return null;
  return { minX, maxX, minY: bounds.minY, maxY: bounds.maxY };
}

function ResponsePlot({ samples, driver, response, bounds, svgRef }: {
  samples: Sample[];
  driver: string;
  response: string;
  bounds: PlotBounds;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const plotId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 1200;
  const height = 760;
  const padding = { top: 36, right: 48, bottom: 84, left: 112 };
  const xAxis = axisTicks(bounds.minX, bounds.maxX);
  const yAxis = axisTicks(bounds.minY, bounds.maxY);
  const x = (value: number) => padding.left + ((value - bounds.minX) / (bounds.maxX - bounds.minX)) * (width - padding.left - padding.right);
  const y = (value: number) => height - padding.bottom - ((value - bounds.minY) / (bounds.maxY - bounds.minY)) * (height - padding.top - padding.bottom);
  const points = samples.map((sample) => `${x(sample.driver)},${y(sample.response)}`).join(" ");
  return (
    <svg ref={svgRef} className="response-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${response} plotted against ${driver}`}>
      <defs>
        <clipPath id={`plot-area-${plotId}`}>
          <rect x={padding.left} y={padding.top} width={width - padding.left - padding.right} height={height - padding.top - padding.bottom} />
        </clipPath>
      </defs>
      {xAxis.values.map((tick, index) => (
        <g key={`x-${index}`}>
          <line x1={x(tick)} y1={padding.top} x2={x(tick)} y2={height - padding.bottom} className="plot-grid" />
          <text x={x(tick)} y={height - padding.bottom + 28} textAnchor="middle" className="plot-label">{formatNumber(tick)}</text>
        </g>
      ))}
      {yAxis.values.map((tick, index) => (
        <g key={`y-${index}`}>
          <line x1={padding.left} y1={y(tick)} x2={width - padding.right} y2={y(tick)} className="plot-grid" />
          <text x={padding.left - 16} y={y(tick) + 6} textAnchor="end" className="plot-label">{formatNumber(tick)}</text>
        </g>
      ))}
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="plot-axis" />
      <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="plot-axis" />
      <polyline points={points} className="plot-line" clipPath={`url(#plot-area-${plotId})`} />
      <text x={width / 2} y={height - 15} textAnchor="middle" className="plot-axis-title">{driver}</text>
      <text transform={`translate(28 ${height / 2}) rotate(-90)`} textAnchor="middle" className="plot-axis-title">{response}</text>
    </svg>
  );
}

function PlotLimitInput({
  className,
  label,
  value,
  invalid,
  onChange,
}: {
  className: string;
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`plot-limit ${className}`}>
      <span>{label}</span>
      <input
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default function Home() {
  const [boardDocument, setBoardDocument] = useState<BoardDocument>(createEmptyBoardDocument);
  const [clientId, setClientId] = useState("");
  const clientIdRef = useRef("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [projectLibrary, setProjectLibrary] = useState<ProjectLibrary | null>(null);
  const [storageMode, setStorageMode] = useState<ProjectStorageMode>("indexeddb");
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectReady, setProjectReady] = useState(false);
  const [projectMessage, setProjectMessage] = useState("");
  const [projectError, setProjectError] = useState("");
  const [localSaveStatus, setLocalSaveStatus] = useState<"saving" | "saved" | "error">("saved");
  const activeProjectIdRef = useRef<string | null>(null);
  const [renamingProject, setRenamingProject] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const localProjectDocumentRef = useRef<BoardDocument>(createEmptyBoardDocument());
  const [roomInput, setRoomInput] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [solveMessage, setSolveMessage] = useState("");
  const [driver, setDriver] = useState("");
  const [response, setResponse] = useState("");
  const [rangeStart, setRangeStart] = useState("0");
  const [rangeEnd, setRangeEnd] = useState("10");
  const [sampleCount, setSampleCount] = useState("21");
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [lastPlot, setLastPlot] = useState<LastPlot | null>(null);
  const [plotBoundDraft, setPlotBoundDraft] = useState<PlotBoundDraft | null>(null);
  const [plotBoundMessage, setPlotBoundMessage] = useState("");
  const [sweepMessage, setSweepMessage] = useState("");
  const [pwaMessage, setPwaMessage] = useState("");
  const [penColor, setPenColor] = useState<BoardPenColor>("navy");
  const [strokeMode, setStrokeMode] = useState<DrawingTool>("freehand");
  const [reportOpen, setReportOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [reporting, setReporting] = useState(false);
  const reportCanvasRef = useRef<HTMLCanvasElement>(null);
  const reportPlotRef = useRef<SVGSVGElement>(null);
  const equationText = boardDocument.equationText.value;
  const known = useMemo(
    () => Object.fromEntries(Object.entries(boardDocument.known).map(([name, field]) => [name, field.value])),
    [boardDocument.known],
  );
  const knownValues = useMemo(
    () => Object.fromEntries(Object.entries(boardDocument.knownValues).map(([name, field]) => [name, field.value])),
    [boardDocument.knownValues],
  );
  const sync = useBoardSync(roomId, clientId, boardDocument, setBoardDocument);
  const activeProjectId = projectLibrary?.activeProjectId;
  const activeProject = projectLibrary?.projects.find((project) => project.id === activeProjectId);

  useEffect(() => {
    const id = crypto.randomUUID();
    clientIdRef.current = id;
    setClientId(id);
    const roomFromLink = new URLSearchParams(window.location.hash.slice(1)).get("board");
    let active = true;
    void loadProjectLibrary().then(({ library, storageMode: mode, warning }) => {
      if (!active) return;
      const selected = library.projects.find((project) => project.id === library.activeProjectId) ?? library.projects[0];
      setProjectLibrary(library);
      setStorageMode(mode);
      if (warning) setProjectMessage(warning);
      activeProjectIdRef.current = selected.id;
      localProjectDocumentRef.current = selected.document;
      if (roomFromLink && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(roomFromLink)) {
        setRoomId(roomFromLink);
        setBoardDocument(readStoredBoard(roomFromLink) ?? createEmptyBoardDocument());
      } else {
        setBoardDocument(selected.document);
      }
      setProjectLoading(false);
      setProjectReady(true);
    }).catch((error: unknown) => {
      if (!active) return;
      setProjectError(error instanceof Error ? error.message : "Local projects could not be loaded.");
      setProjectLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!projectReady || roomId || !projectLibrary) return;
    localProjectDocumentRef.current = boardDocument;
    setLocalSaveStatus("saving");
    const timeout = window.setTimeout(() => {
      void saveLocalProject(storageMode, projectLibrary.activeProjectId, boardDocument)
        .then((updated) => {
          if (activeProjectIdRef.current === projectLibrary.activeProjectId) {
            setProjectLibrary(updated);
            setLocalSaveStatus("saved");
            setProjectError("");
          }
        })
        .catch((error: unknown) => {
          if (activeProjectIdRef.current === projectLibrary.activeProjectId) {
            setLocalSaveStatus("error");
            setProjectError(error instanceof Error ? error.message : "The project could not be saved locally.");
          }
        });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [boardDocument, projectLibrary?.activeProjectId, projectReady, roomId, storageMode]);

  useEffect(() => {
    if (!projectReady || roomId || !projectLibrary) return;
    const saveBeforeSuspension = () => {
      void saveLocalProject(storageMode, projectLibrary.activeProjectId, boardDocument)
        .then((updated) => {
          if (activeProjectIdRef.current === projectLibrary.activeProjectId) setProjectLibrary(updated);
        })
        .catch((error: unknown) => {
          if (activeProjectIdRef.current === projectLibrary.activeProjectId) {
            setLocalSaveStatus("error");
            setProjectError(error instanceof Error ? error.message : "The project could not be saved locally.");
          }
        });
    };
    const onVisibilityChange = () => {
      if (window.document.visibilityState === "hidden") saveBeforeSuspension();
    };
    window.addEventListener("pagehide", saveBeforeSuspension);
    window.document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", saveBeforeSuspension);
      window.document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [boardDocument, projectLibrary?.activeProjectId, projectReady, roomId, storageMode]);

  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/sw.js").catch(() => setPwaMessage("Offline app caching could not be enabled. The whiteboard is still available online."));
    }
  }, []);

  const parsed = useMemo(() => {
    if (!equationText.trim()) return { equations: [] as LinearEquation[], error: "" };
    try {
      return { equations: parseEquations(equationText), error: "" };
    } catch (error) {
      return { equations: [] as LinearEquation[], error: error instanceof Error ? error.message : "Could not parse the equations." };
    }
  }, [equationText]);
  const variables = useMemo(() => extractVariables(parsed.equations), [parsed.equations]);
  const knownNumericValues = useMemo(() => {
    const values: Record<string, number> = {};
    for (const name of variables) {
      if (!known[name]) continue;
      const raw = knownValues[name]?.trim() ?? "";
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) return null;
      values[name] = value;
    }
    return values;
  }, [known, knownValues, variables]);
  const calculatedValues = useMemo(
    () => parsed.error ? {} : calculateVariables(parsed.equations, variables, knownNumericValues),
    [knownNumericValues, parsed, variables],
  );
  const availableValues = useMemo(
    () => knownNumericValues === null ? null : { ...knownNumericValues, ...calculatedValues },
    [calculatedValues, knownNumericValues],
  );
  const unknowns = variables.filter((name) => !known[name] && !(name in calculatedValues));
  const currentDriver = driver && unknowns.includes(driver) ? driver : unknowns[0] ?? "";
  const currentResponse = response && unknowns.includes(response) && response !== currentDriver
    ? response
    : unknowns.find((name) => name !== currentDriver) ?? "";
  const enoughEquations = parsed.equations.length >= unknowns.length;

  const solve = () => {
    setResult(null);
    setSolveMessage("");
    setSamples(null);
    if (!parsed.equations.length || parsed.error) {
      setSolveMessage(parsed.error || "Add at least one valid equation before solving.");
      return;
    }
    if (availableValues === null) {
      setSolveMessage("Enter a finite numeric value for every variable marked known.");
      return;
    }
    const solved = solveSystem(parsed.equations, unknowns, availableValues);
    setResult(solved);
    if (!solved.ok) setSolveMessage(solved.message);
  };

  const runSweep = () => {
    setSamples(null);
    setSweepMessage("");
    setPlotBoundMessage("");
    if (availableValues === null) {
      setSweepMessage("Enter a finite value for each known variable first.");
      return;
    }
    if (!currentDriver || !currentResponse || currentDriver === currentResponse) {
      setSweepMessage("Choose two different unknown variables for the sweep.");
      return;
    }
    const start = Number(rangeStart);
    const end = Number(rangeEnd);
    const count = Number(sampleCount);
    if (!rangeStart.trim() || !rangeEnd.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setSweepMessage("Enter a finite range with an end greater than its start.");
      return;
    }
    if (!Number.isInteger(count) || count < 2 || count > 101) {
      setSweepMessage("Choose between 2 and 101 samples.");
      return;
    }
    const sweep = buildSamples(parsed.equations, unknowns, availableValues, currentDriver, currentResponse, start, end, count);
    if (!sweep.samples) {
      setSweepMessage(sweep.error ?? "The parameter sweep could not be computed.");
      return;
    }
    const bounds = defaultPlotBounds(sweep.samples);
    if (!bounds) {
      setSweepMessage("The result range is too large or too small to plot. Use a narrower sweep range.");
      return;
    }
    setPlotBoundDraft({
      minX: String(bounds.minX),
      maxX: String(bounds.maxX),
      minY: String(bounds.minY),
      maxY: String(bounds.maxY),
    });
    setSamples(sweep.samples);
    setLastPlot({ samples: sweep.samples, driver: currentDriver, response: currentResponse, bounds });
  };

  useEffect(() => {
    if (!samples && !reportOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSamples(null);
        setReportOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [reportOpen, samples]);

  const updateEquations = (value: string) => {
    setBoardDocument((current) => setEquationText(current, value, clientIdRef.current));
    setResult(null);
    setSamples(null);
    setSolveMessage("");
    setSweepMessage("");
  };

  const updatePlotBound = (key: keyof PlotBounds, value: string) => {
    if (!plotBoundDraft) return;
    const nextDraft = { ...plotBoundDraft, [key]: value };
    setPlotBoundDraft(nextDraft);
    const xRange = validateAxisRange(nextDraft.minX, nextDraft.maxX);
    if (!xRange.ok) {
      setPlotBoundMessage(`X axis: ${xRange.message}`);
      return;
    }
    const yRange = validateAxisRange(nextDraft.minY, nextDraft.maxY);
    if (!yRange.ok) {
      setPlotBoundMessage(`Y axis: ${yRange.message}`);
      return;
    }
    const bounds = { minX: xRange.range.min, maxX: xRange.range.max, minY: yRange.range.min, maxY: yRange.range.max };
    setLastPlot((current) => current ? { ...current, bounds } : current);
    setPlotBoundMessage("");
  };

  const plotXRange = plotBoundDraft ? validateAxisRange(plotBoundDraft.minX, plotBoundDraft.maxX) : null;
  const plotYRange = plotBoundDraft ? validateAxisRange(plotBoundDraft.minY, plotBoundDraft.maxY) : null;

  const updateStroke = useCallback((id: string, points: Point[], deleted: boolean, style?: BoardStrokeStyle) => {
    const currentClientId = clientIdRef.current;
    if (!currentClientId) return;
    setBoardDocument((current) => setStroke(current, id, points, deleted, currentClientId, style));
  }, []);

  const flushLocalProject = async () => {
    if (!projectReady || !projectLibrary || roomId) return projectLibrary;
    const updated = await saveLocalProject(storageMode, projectLibrary.activeProjectId, boardDocument);
    setProjectLibrary(updated);
    localProjectDocumentRef.current = boardDocument;
    setLocalSaveStatus("saved");
    return updated;
  };

  const activateProject = async (id: string) => {
    setProjectError("");
    setProjectMessage("");
    try {
      await flushLocalProject();
      const updated = await activateLocalProject(storageMode, id);
      const selected = updated.projects.find((project) => project.id === id);
      if (!selected) throw new Error("That project no longer exists on this device.");
      activeProjectIdRef.current = selected.id;
      setProjectLibrary(updated);
      localProjectDocumentRef.current = selected.document;
      setBoardDocument(selected.document);
      setRoomId(null);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "The project could not be opened.");
    }
  };

  const createProject = async () => {
    setProjectError("");
    setProjectMessage("");
    try {
      await flushLocalProject();
      const name = `Project ${(projectLibrary?.projects.length ?? 0) + 1}`;
      const updated = await createLocalProject(storageMode, name, createEmptyBoardDocument());
      const created = updated.projects.find((project) => project.id === updated.activeProjectId);
      if (!created) throw new Error("The new project could not be opened.");
      activeProjectIdRef.current = created.id;
      setProjectLibrary(updated);
      localProjectDocumentRef.current = created.document;
      setBoardDocument(created.document);
      setRoomId(null);
      setRenamingProject(false);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setProjectMessage(`Created "${created.name}".`);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "The project could not be created.");
    }
  };

  const renameProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectLibrary) return;
    setProjectError("");
    try {
      const updated = await renameLocalProject(storageMode, projectLibrary.activeProjectId, projectNameDraft);
      setProjectLibrary(updated);
      setRenamingProject(false);
      setProjectMessage("Project renamed.");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "The project could not be renamed.");
    }
  };

  const removeProject = async () => {
    if (!projectLibrary || !activeProject) return;
    if (!window.confirm(`Delete "${activeProject.name}" from this device? This cannot be undone.`)) return;
    setProjectError("");
    try {
      const updated = await deleteLocalProject(storageMode, activeProject.id);
      const selected = updated.projects.find((project) => project.id === updated.activeProjectId);
      if (!selected) throw new Error("A replacement project could not be opened.");
      activeProjectIdRef.current = selected.id;
      setProjectLibrary(updated);
      localProjectDocumentRef.current = selected.document;
      setBoardDocument(selected.document);
      setRoomId(null);
      setRenamingProject(false);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setProjectMessage("Project deleted from this device.");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "The project could not be deleted.");
    }
  };

  const exportProject = () => {
    if (!activeProject) return;
    try {
      const content = serializeProjectFile(activeProject.name, roomId ? localProjectDocumentRef.current : boardDocument);
      const blob = new Blob([content], { type: "application/vnd.fbd-whiteboard+json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${activeProject.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-")}.fbdproject`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProjectError("");
      setProjectMessage(`Exported "${activeProject.name}" to a project file.`);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "The project file could not be exported.");
    }
  };

  const importProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProjectError("");
    setProjectMessage("");
    if (file.size > 5_000_000) {
      setProjectError("This project file is too large to import (maximum 5 MB).");
      return;
    }
    try {
      const imported = parseProjectFile(await file.text());
      await flushLocalProject();
      const existingNames = new Set((projectLibrary?.projects ?? []).map((project) => project.name.toLowerCase()));
      let name = imported.project.name;
      if (existingNames.has(name.toLowerCase())) {
        let suffix = 1;
        do {
          const suffixText = suffix === 1 ? " (imported)" : ` (imported ${suffix})`;
          name = `${imported.project.name.slice(0, 80 - suffixText.length)}${suffixText}`;
          suffix += 1;
        } while (existingNames.has(name.toLowerCase()));
      }
      const updated = await createLocalProject(storageMode, name, imported.project.document);
      const created = updated.projects.find((project) => project.id === updated.activeProjectId);
      if (!created) throw new Error("The imported project could not be opened.");
      activeProjectIdRef.current = created.id;
      setProjectLibrary(updated);
      localProjectDocumentRef.current = created.document;
      setBoardDocument(created.document);
      setRoomId(null);
      setRenamingProject(false);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setProjectMessage(`Imported "${created.name}" as a new project. Your existing projects were not replaced.`);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "The project file could not be imported.");
    }
  };

  const activateRoom = async (id: string, restore = true) => {
    if (!projectReady) {
      setProjectError("Wait for local project storage to finish loading before opening a shared board.");
      return;
    }
    try {
      await flushLocalProject();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "The current local project could not be saved.");
      return;
    }
    if (restore) {
      const saved = readStoredBoard(id);
      setBoardDocument(saved ?? createEmptyBoardDocument());
    }
    setRoomId(id);
    setShareMessage("");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#board=${id}`);
  };

  const createBoardLink = async () => {
    if (!boardSyncConfigured) {
      setShareMessage("Live sharing is not configured on this deployment yet. Follow the Supabase setup in README.");
      return;
    }
    await activateRoom(crypto.randomUUID(), false);
  };

  const joinBoard = async () => {
    if (!boardSyncConfigured) {
      setShareMessage("Live sharing is not configured on this deployment yet. Follow the Supabase setup in README.");
      return;
    }
    let candidate = roomInput.trim();
    try {
      const url = new URL(candidate, window.location.origin);
      candidate = new URLSearchParams(url.hash.slice(1)).get("board") ?? candidate;
    } catch {
      candidate = candidate.replace(/^#?board=/, "");
    }
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(candidate)) {
      setShareMessage("Paste a valid FBD Whiteboard share link or board ID.");
      return;
    }
    await activateRoom(candidate);
  };

  const copyBoardLink = async () => {
    const link = `${window.location.origin}${window.location.pathname}${window.location.search}#board=${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      setShareMessage("Share link copied.");
    } catch {
      setShareMessage("Copy was blocked. Select and copy the share link below.");
    }
  };

  const leaveBoard = () => {
    setRoomId(null);
    setBoardDocument(localProjectDocumentRef.current);
    setShareMessage("");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  };

  const updateKnown = (name: string, value: boolean) => {
    setBoardDocument((current) => {
      const updated = setKnown(current, name, value, clientIdRef.current);
      return value && name in calculatedValues
        ? setKnownValue(updated, name, String(calculatedValues[name]), clientIdRef.current)
        : updated;
    });
    setResult(null);
    setSamples(null);
    setSolveMessage("");
    setSweepMessage("");
  };

  const updateKnownValue = (name: string, value: string) => {
    setBoardDocument((current) => setKnownValue(current, name, value, clientIdRef.current));
    setResult(null);
    setSamples(null);
    setSolveMessage("");
    setSweepMessage("");
  };

  const exportReport = async () => {
    setReporting(true);
    setReportMessage("");
    try {
      const { createBoardReport, cropSketchToPng, svgToPng } = await import("../lib/board-report");
      const canvas = reportCanvasRef.current;
      if (!canvas) throw new Error("The diagram is not ready to export. Try again.");
      let plotPng: string | undefined;
      if (lastPlot) {
        const svg = reportPlotRef.current;
        if (!svg) throw new Error("The last plot is not ready to export. Try again.");
        plotPng = await svgToPng(svg);
      }
      const pdf = createBoardReport({
        title: projectTitle,
        generatedAt: new Date(),
        equations: equationText,
        variables: variables.map((name) => ({
          name,
          known: !!known[name],
          calculated: !known[name] && name in calculatedValues,
          value: known[name] ? knownValues[name] ?? "" : name in calculatedValues ? formatNumber(calculatedValues[name]) : "",
        })),
        ...(parsed.error ? { parseError: parsed.error } : {}),
        sketchPng: cropSketchToPng(canvas),
        ...(lastPlot && plotPng ? {
          plot: {
            png: plotPng,
            driver: lastPlot.driver,
            response: lastPlot.response,
          },
        } : {}),
      });
      const filename = (projectTitle.trim() || "mechanics-report")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
      pdf.save(`${filename || "mechanics-report"}.pdf`);
      setReportOpen(false);
    } catch (error) {
      setReportMessage(error instanceof Error ? error.message : "Could not generate the PDF report.");
    } finally {
      setReporting(false);
    }
  };

  return (
    <main className="whiteboard">
      <header className="board-toolbar">
        <div className="brand-group">
          <a className="brand" href="/" aria-label="FBD Whiteboard">
            <span className="brand-mark" aria-hidden="true">F</span>
            <span>FBD <strong>Whiteboard</strong></span>
          </a>
          <span className="brand-logo">
            <img src="/vaderstad-logo.svg" alt="Väderstad" />
          </span>
        </div>
        <div className="toolbar-actions">
          <details className="project-menu">
            <summary aria-label="Manage local projects">
              {projectLoading ? "Projects…" : activeProject?.name ?? "Projects"}
            </summary>
            <div className="project-popover">
              <strong>Projects on this device</strong>
              <p>Projects autosave in this browser and stay separate from shared boards.</p>
              {projectLibrary && (
                <>
                  <label className="project-control-label" htmlFor="active-project">Open project</label>
                  <select
                    id="active-project"
                    className="project-select"
                    value={projectLibrary.activeProjectId}
                    onChange={(event) => void activateProject(event.target.value)}
                    disabled={projectLoading || !projectReady}
                  >
                    {projectLibrary.projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </>
              )}
              {renamingProject ? (
                <form className="project-rename-form" onSubmit={(event) => void renameProject(event)}>
                  <label className="project-control-label" htmlFor="project-name">Project name</label>
                  <input
                    id="project-name"
                    className="project-name-input"
                    value={projectNameDraft}
                    maxLength={80}
                    onChange={(event) => setProjectNameDraft(event.target.value)}
                    autoFocus
                    required
                  />
                  <div className="project-buttons">
                    <button className="secondary-button" type="submit">Save name</button>
                    <button className="quiet-button" type="button" onClick={() => setRenamingProject(false)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="project-buttons">
                  <button className="secondary-button" type="button" onClick={() => void createProject()} disabled={projectLoading || !projectReady}>New project</button>
                  <button className="quiet-button" type="button" disabled={!projectReady || !activeProject} onClick={() => {
                    if (!activeProject) return;
                    setProjectNameDraft(activeProject.name);
                    setRenamingProject(true);
                  }}>Rename</button>
                  <button className="quiet-button project-delete-button" type="button" disabled={!projectReady || !activeProject} onClick={() => void removeProject()}>Delete</button>
                </div>
              )}
              <div className="project-buttons project-file-actions">
                <button className="secondary-button" type="button" onClick={exportProject} disabled={!projectReady || !activeProject}>Export project</button>
                <button className="quiet-button" type="button" disabled={projectLoading || !projectReady} onClick={() => projectFileInputRef.current?.click()}>Import project</button>
                <input
                  ref={projectFileInputRef}
                  className="sr-only"
                  type="file"
                  accept=".fbdproject,.json,application/json"
                  aria-label="Choose an FBD project file to import"
                  onChange={(event) => void importProjectFile(event)}
                />
              </div>
              <p className="project-save-status" role="status" aria-live="polite">
                {projectLoading ? "Loading saved projects…" : !projectReady ? "Local project storage is unavailable." : roomId ? "Shared board; this local project is unchanged." : localSaveStatus === "saving" ? "Saving on this device…" : localSaveStatus === "error" ? "Local save failed." : storageMode === "indexeddb" ? "Saved on this device." : "Saved in browser storage."}
              </p>
              {projectMessage && <p className="project-message" role="status">{projectMessage}</p>}
            </div>
          </details>
          <button className="report-button" type="button" onClick={() => { setReportMessage(""); setReportOpen(true); }}>PDF report</button>
          <span className={`local-indicator sync-indicator sync-${sync.status}`} aria-live="polite">
            <span />{sync.status === "connected" ? sync.deviceCount > 1 ? `${sync.deviceCount} devices` : "Sync ready" : sync.status === "connecting" ? "Connecting" : sync.status === "error" ? "Sync issue" : "Local"}
          </span>
          <details className="share-menu">
            <summary>Share</summary>
            <div className="share-popover">
              <strong>{roomId ? "Shared board" : "Share this board"}</strong>
              {!boardSyncConfigured && <p>Live sync needs a Supabase project. See the setup steps in README.</p>}
              {roomId ? (
                <>
                  <p>{sync.status === "connected" ? sync.deviceCount > 1 ? `${sync.deviceCount} devices connected; changes sync live.` : "Sync service ready; open this link on another device." : "Board link ready. Waiting for sync service."} Anyone with the link can edit this board.</p>
                  <label className="share-link-label" htmlFor="share-link">Invite link</label>
                  <input id="share-link" className="share-link-input" readOnly value={`${typeof window === "undefined" ? "" : window.location.origin + window.location.pathname + window.location.search}#board=${roomId}`} onFocus={(event) => event.currentTarget.select()} />
                  <div className="share-buttons">
                    <button type="button" className="secondary-button" onClick={copyBoardLink}>Copy link</button>
                    <button type="button" className="quiet-button" onClick={leaveBoard}>Leave room</button>
                  </div>
                </>
              ) : (
                <>
                  <p>Generate a private link, then open it on your other device.</p>
                  {boardSyncConfigured && <p>Sharing sends equations, known values, and sketch strokes to Supabase.</p>}
                  <button type="button" className="secondary-button" disabled={!boardSyncConfigured || !projectReady} onClick={createBoardLink}>Create share link</button>
                  <label className="share-link-label" htmlFor="join-board">Or join a board</label>
                  <input id="join-board" className="share-link-input" value={roomInput} onChange={(event) => setRoomInput(event.target.value)} placeholder="Paste link or board ID" />
                  <button type="button" className="quiet-button" disabled={!boardSyncConfigured || !projectReady} onClick={joinBoard}>Join board</button>
                </>
              )}
              {(shareMessage || sync.error) && <p className={sync.error ? "share-error" : "share-message"} role={sync.error ? "alert" : "status"}>{sync.error || shareMessage}</p>}
            </div>
          </details>
          <details className="help-menu">
            <summary aria-label="Help" title="Help">?</summary>
            <div className="help-popover">
              <strong>Apple Pencil</strong>
              <p>Turn on Scribble in Settings → Apple Pencil. Write one equation per line, then check the text.</p>
              <p>This app does not provide cloud Mathpix OCR. On iPad, use the on-device Scribble feature to enter handwriting while offline.</p>
              <strong>Math input</strong>
              <p>Use <code>sqrt(x)</code>, <code>abs(x)</code>, or <code>|x|</code>. Trig functions use degrees. Length values assume inches; keep units consistent.</p>
            </div>
          </details>
        </div>
      </header>

      {(pwaMessage || projectError) && (
        <p className={`pwa-warning ${projectError ? "project-error-warning" : ""}`} role={projectError ? "alert" : "status"}>
          {projectError || pwaMessage}
        </p>
      )}
      {projectLoading && <div className="project-loading" role="status">Opening projects saved on this device…</div>}

      <div className={`board-split ${projectLoading ? "projects-loading" : ""}`} aria-busy={projectLoading}>
        <section className="board-pane sketch-pane" aria-label="Free body diagram">
          <DrawingPad
            label="Free body diagram sketch pad"
            strokeRecords={boardDocument.strokes}
            onStrokeChange={updateStroke}
            reportCanvasRef={reportCanvasRef}
            penColor={penColor}
            onPenColorChange={setPenColor}
            strokeMode={strokeMode}
            onStrokeModeChange={setStrokeMode}
          />
        </section>

        <section className="board-pane math-pane" aria-label="Equations and solution">
          <div className="pane-toolbar">
            <h2>Equations</h2>
            <span className="equation-count">{parsed.equations.length} eq · {unknowns.length} unknown</span>
          </div>
          <label className="sr-only" htmlFor="equations">Equations, one per line</label>
          <textarea
            id="equations"
            className="equation-editor"
            value={equationText}
            onChange={(event) => updateEquations(event.target.value)}
            placeholder={"Fx = 0\nF = m*a"}
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />

          <div className="math-scroll">
            {parsed.error && <p className="inline-message error" role="alert">{parsed.error}</p>}
            {parsed.equations.length > 0 && !parsed.error && (
              <div className="equation-preview" aria-label="Equation variable highlighting">
                <div className="preview-title"><span><i className="known-key" /> Known <i className="calculated-key" /> Calculated <i className="unknown-key" /> Unknown</span></div>
                {parsed.equations.map((equation, index) => (
                  <div className="preview-equation" key={`${index}-${equation.source}`}>
                    <span className="equation-index">{index + 1}</span>
                    <HighlightedEquation equation={equation.source} variables={variables} known={known} calculated={calculatedValues} />
                  </div>
                ))}
              </div>
            )}

            {variables.length > 0 && !parsed.error && (
              <div className="variable-section">
                <div className="subsection-heading">
                  <h3>Variables</h3>
                  {!enoughEquations && <span className="system-warning">{parsed.equations.length} eq · {unknowns.length} unknown</span>}
                </div>
                <div className="variable-list">
                  {variables.map((name) => (
                    <div className={`variable-row ${known[name] ? "known-row" : name in calculatedValues ? "calculated-row" : ""}`} key={name}>
                      <span className={`variable-symbol ${known[name] ? "known-text" : name in calculatedValues ? "calculated-text" : "unknown-text"}`}>{name}</span>
                      {known[name] ? (
                        <label className="known-input-wrap">
                          <span className="sr-only">{name} known value</span>
                          <input
                            inputMode="decimal"
                            value={knownValues[name] ?? ""}
                            onChange={(event) => updateKnownValue(name, event.target.value)}
                            placeholder="Value"
                          />
                        </label>
                      ) : name in calculatedValues ? (
                        <span className="calculated-value" title="Calculated from the current equations and known values">
                          {formatNumber(calculatedValues[name])}
                        </span>
                      ) : <span className="variable-inferred">Unknown</span>}
                      <button
                        className="known-toggle"
                        type="button"
                        aria-label={known[name] ? `Mark ${name} unknown` : `Mark ${name} known`}
                        aria-pressed={!!known[name]}
                        onClick={() => updateKnown(name, !known[name])}
                      >{known[name] ? "Known ✓" : "Set known"}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {solveMessage && <p className="inline-message error" role="alert">{solveMessage}</p>}
            {result?.ok && (
              <div className="result-card" role="status">
                <div className="result-heading"><span className="result-check">✓</span><strong>Solved</strong></div>
                <div className="result-values">
                  {variables.map((name) => {
                    const value = known[name] ? knownNumericValues?.[name] : calculatedValues[name] ?? result.values[name];
                    const valueClass = known[name] ? "known-text" : name in calculatedValues ? "calculated-text" : "unknown-text";
                    return <div className="result-value" key={name}><span className={valueClass}>{name}</span><strong>{value === undefined ? "—" : formatNumber(value)}</strong></div>;
                  })}
                </div>
              </div>
            )}
          </div>

          {variables.length > 0 && (
            <div className="math-actions">
              <details className="sweep-tools">
                <summary>Parameter sweep</summary>
                <div className="sweep-body">
                {unknowns.length < 2 || parsed.error || !parsed.equations.length ? (
                  <p className="sweep-note">Add two unknowns.</p>
                ) : (
                  <>
                    <div className="sweep-controls">
                      <label>Drive
                        <select value={currentDriver} onChange={(event) => { setDriver(event.target.value); setSamples(null); }}>
                          {unknowns.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </label>
                      <label>Response
                        <select value={currentResponse} onChange={(event) => { setResponse(event.target.value); setSamples(null); }}>
                          {unknowns.filter((name) => name !== currentDriver).map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="range-controls">
                      <label>From <input inputMode="decimal" aria-label="Range start" value={rangeStart} onChange={(event) => { setRangeStart(event.target.value); setSamples(null); setSweepMessage(""); }} /></label>
                      <label>To <input inputMode="decimal" aria-label="Range end" value={rangeEnd} onChange={(event) => { setRangeEnd(event.target.value); setSamples(null); setSweepMessage(""); }} /></label>
                      <label>Points <input inputMode="numeric" type="number" min="2" max="101" aria-label="Sample count" value={sampleCount} onChange={(event) => { setSampleCount(event.target.value); setSamples(null); setSweepMessage(""); }} /></label>
                    </div>
                    <button className="secondary-button" onClick={runSweep} type="button">Plot range</button>
                    {sweepMessage && <p className="inline-message error" role="alert">{sweepMessage}</p>}
                  </>
                )}
                </div>
              </details>
              <button className="solve-button" onClick={solve} disabled={!enoughEquations || !!parsed.error || knownNumericValues === null} type="button">Solve</button>
            </div>
          )}
        </section>
      </div>
      {samples && (
        <section className="plot-dialog" role="dialog" aria-modal="true" aria-labelledby="plot-title">
          <header className="plot-toolbar">
            <h2 id="plot-title">{currentResponse} vs. {currentDriver}</h2>
            <button className="plot-close" type="button" onClick={() => setSamples(null)} autoFocus>Close plot</button>
          </header>
          {plotBoundDraft && lastPlot && (
            <div className="plot-stage">
              <ResponsePlot samples={samples} driver={currentDriver} response={currentResponse} bounds={lastPlot.bounds} />
              <PlotLimitInput className="plot-limit-x-min" label="X minimum" value={plotBoundDraft.minX} invalid={plotXRange?.ok === false} onChange={(value) => updatePlotBound("minX", value)} />
              <PlotLimitInput className="plot-limit-x-max" label="X maximum" value={plotBoundDraft.maxX} invalid={plotXRange?.ok === false} onChange={(value) => updatePlotBound("maxX", value)} />
              <PlotLimitInput className="plot-limit-y-min" label="Y minimum" value={plotBoundDraft.minY} invalid={plotYRange?.ok === false} onChange={(value) => updatePlotBound("minY", value)} />
              <PlotLimitInput className="plot-limit-y-max" label="Y maximum" value={plotBoundDraft.maxY} invalid={plotYRange?.ok === false} onChange={(value) => updatePlotBound("maxY", value)} />
            </div>
          )}
          {plotBoundMessage && <p className="plot-range-error" role="alert">{plotBoundMessage}</p>}
          <div className="sample-table-wrap plot-table">
            <table>
              <thead><tr><th>{currentDriver}</th><th>{currentResponse}</th></tr></thead>
              <tbody>{samples.map((sample, index) => <tr key={`${index}-${sample.driver}`}><td>{formatNumber(sample.driver)}</td><td>{formatNumber(sample.response)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      {lastPlot && (
        <div className="report-plot-source" aria-hidden="true">
          <ResponsePlot
            samples={lastPlot.samples}
            driver={lastPlot.driver}
            response={lastPlot.response}
            bounds={lastPlot.bounds}
            svgRef={reportPlotRef}
          />
        </div>
      )}
      {reportOpen && (
        <div className="report-overlay" onClick={() => !reporting && setReportOpen(false)}>
          <section
            className="report-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="report-dialog-heading">
              <div>
                <h2 id="report-title">PDF report</h2>
                <p>One page, generated on this device.</p>
              </div>
              <button className="report-close" type="button" aria-label="Close report dialog" onClick={() => setReportOpen(false)}>×</button>
            </div>
            <label className="report-title-label" htmlFor="project-title">Project title</label>
            <input
              id="project-title"
              className="report-title-input"
              value={projectTitle}
              maxLength={100}
              onChange={(event) => setProjectTitle(event.target.value)}
              placeholder="Untitled mechanics report"
            />
            <p className="report-includes">
              Includes the diagram, equations, and variable status{lastPlot ? ", plus the last plot generated." : "."}
            </p>
            {reportMessage && <p className="inline-message error" role="alert">{reportMessage}</p>}
            <button className="solve-button report-export" type="button" onClick={() => void exportReport()} disabled={reporting}>
              {reporting ? "Creating PDF..." : "Download PDF"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
