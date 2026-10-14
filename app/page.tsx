"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type Ref, type RefObject } from "react";
import { extractVariables, LinearEquation, MathInputError, parseEquations, solveSystem, SolveResult } from "../lib/math";
import {
  BoardDocument,
  BoardPoint,
  BoardStroke,
  compareRevision,
  createEmptyBoardDocument,
  setEquationText,
  setKnown,
  setKnownValue,
  setStroke,
} from "../lib/board-document";
import { boardSyncConfigured, readStoredBoard, useBoardSync } from "../lib/use-board-sync";
import { calculateVariables } from "../lib/calculated-variables";

type Point = BoardPoint;
type Sample = { driver: number; response: number };

function DrawingPad({
  label,
  className = "",
  onUndoStateChange,
  strokeRecords,
  onStrokeChange,
  reportCanvasRef,
}: {
  label: string;
  className?: string;
  onUndoStateChange: (available: boolean) => void;
  strokeRecords: Record<string, BoardStroke>;
  onStrokeChange: (id: string, points: Point[], deleted: boolean) => void;
  reportCanvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef(strokeRecords);
  const activeStrokeRef = useRef<{ id: string; points: Point[] } | null>(null);
  const lastSyncAtRef = useRef(0);
  const [hasMarks, setHasMarks] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#172b4d";
    context.lineCap = "round";
    context.lineJoin = "round";
    const strokes = [
      ...Object.values(strokesRef.current)
        .filter((stroke) => !stroke.deleted)
        .sort((left, right) => compareRevision(left.created, right.created))
        .map((stroke) => stroke.points),
      ...(activeStrokeRef.current ? [activeStrokeRef.current.points] : []),
    ];
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      context.beginPath();
      context.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
      for (const point of stroke.slice(1)) {
        context.lineWidth = Math.max(1.5, point.pressure * 3.2) * (window.devicePixelRatio || 1);
        context.lineTo(point.x * canvas.width, point.y * canvas.height);
      }
      context.stroke();
    }
  }, []);

  useEffect(() => {
    strokesRef.current = strokeRecords;
    const visibleStrokes = Object.values(strokeRecords).filter((stroke) => !stroke.deleted);
    setHasMarks(visibleStrokes.length > 0);
    onUndoStateChange(visibleStrokes.length > 0);
    redraw();
  }, [onUndoStateChange, redraw, strokeRecords]);

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

  const clear = () => {
    const removedStrokes = Object.entries(strokesRef.current).filter(([, stroke]) => !stroke.deleted);
    strokesRef.current = Object.fromEntries(
      Object.entries(strokesRef.current).map(([id, stroke]) => [id, { ...stroke, deleted: true, points: [] }]),
    );
    for (const [id] of removedStrokes) onStrokeChange(id, [], true);
    activeStrokeRef.current = null;
    setHasMarks(false);
    onUndoStateChange(false);
    redraw();
  };

  const undo = () => {
    const last = Object.entries(strokesRef.current)
      .filter(([, stroke]) => !stroke.deleted)
      .sort((left, right) => compareRevision(right[1].created, left[1].created))[0];
    if (!last) return;
    const [id, stroke] = last;
    strokesRef.current = { ...strokesRef.current, [id]: { ...stroke, deleted: true, points: [] } };
    onStrokeChange(id, [], true);
    const hasVisibleStrokes = Object.values(strokesRef.current).some((item) => !item.deleted);
    setHasMarks(hasVisibleStrokes);
    onUndoStateChange(hasVisibleStrokes);
    redraw();
  };

  useEffect(() => {
    window.addEventListener("clear-sketch", clear);
    window.addEventListener("undo-sketch", undo);
    return () => {
      window.removeEventListener("clear-sketch", clear);
      window.removeEventListener("undo-sketch", undo);
    };
  }, [onStrokeChange, onUndoStateChange, redraw]);

  return (
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
          event.currentTarget.setPointerCapture(event.pointerId);
          activeStrokeRef.current = { id: crypto.randomUUID(), points: [pointFromEvent(event)] };
          lastSyncAtRef.current = performance.now();
          redraw();
        }}
        onPointerMove={(event) => {
          if (!activeStrokeRef.current) return;
          event.preventDefault();
          activeStrokeRef.current.points.push(pointFromEvent(event));
          if (performance.now() - lastSyncAtRef.current >= 100) {
            const { id, points } = activeStrokeRef.current;
            onStrokeChange(id, [...points], false);
            lastSyncAtRef.current = performance.now();
          }
          redraw();
        }}
        onPointerUp={(event) => {
          if (!activeStrokeRef.current) return;
          const { id, points } = activeStrokeRef.current;
          onStrokeChange(id, [...points], false);
          strokesRef.current = {
            ...strokesRef.current,
            [id]: {
              points,
              deleted: false,
              revision: { counter: Date.now(), clientId: id },
              created: { counter: Date.now(), clientId: id },
            },
          };
          activeStrokeRef.current = null;
          setHasMarks(true);
          onUndoStateChange(true);
          redraw();
        }}
        onPointerCancel={() => {
          if (activeStrokeRef.current) {
            const { id, points } = activeStrokeRef.current;
            onStrokeChange(id, [...points], false);
            strokesRef.current = {
              ...strokesRef.current,
              [id]: {
                points,
                deleted: false,
                revision: { counter: Date.now(), clientId: id },
                created: { counter: Date.now(), clientId: id },
              },
            };
            activeStrokeRef.current = null;
            setHasMarks(true);
            onUndoStateChange(true);
            redraw();
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onLostPointerCapture={() => {
          if (activeStrokeRef.current) {
            const { id, points } = activeStrokeRef.current;
            onStrokeChange(id, [...points], false);
            activeStrokeRef.current = null;
            redraw();
          }
        }}
      />
      {!hasMarks && <div className="pad-placeholder" aria-hidden="true">Write or draw here with Apple Pencil</div>}
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 }).format(value);
}

function axisTicks(min: number, max: number) {
  const span = max - min || Math.max(1, Math.abs(min) * 0.1);
  const roughStep = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const values = Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => start + index * step);
  return { min: start, max: end === start ? start + step : end, values };
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

function ResponsePlot({ samples, driver, response, svgRef }: {
  samples: Sample[];
  driver: string;
  response: string;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const width = 1200;
  const height = 760;
  const padding = { top: 36, right: 48, bottom: 84, left: 112 };
  const xs = samples.map((sample) => sample.driver);
  const ys = samples.map((sample) => sample.response);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);
  const yPadding = rawMinY === rawMaxY ? Math.max(1, Math.abs(rawMinY) * 0.05) : (rawMaxY - rawMinY) * 0.05;
  const minY = rawMinY - yPadding;
  const maxY = rawMaxY + yPadding;
  const xAxis = axisTicks(minX, maxX);
  const yAxis = axisTicks(minY, maxY);
  const x = (value: number) => padding.left + ((value - xAxis.min) / (xAxis.max - xAxis.min)) * (width - padding.left - padding.right);
  const y = (value: number) => height - padding.bottom - ((value - yAxis.min) / (yAxis.max - yAxis.min)) * (height - padding.top - padding.bottom);
  const points = samples.map((sample) => `${x(sample.driver)},${y(sample.response)}`).join(" ");
  return (
    <svg ref={svgRef} className="response-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${response} plotted against ${driver}`}>
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
      <polyline points={points} className="plot-line" />
      <text x={width / 2} y={height - 15} textAnchor="middle" className="plot-axis-title">{driver}</text>
      <text transform={`translate(28 ${height / 2}) rotate(-90)`} textAnchor="middle" className="plot-axis-title">{response}</text>
    </svg>
  );
}

export default function Home() {
  const [boardDocument, setBoardDocument] = useState<BoardDocument>(createEmptyBoardDocument);
  const [clientId, setClientId] = useState("");
  const clientIdRef = useRef("");
  const [roomId, setRoomId] = useState<string | null>(null);
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
  const [lastPlot, setLastPlot] = useState<{ samples: Sample[]; driver: string; response: string } | null>(null);
  const [sweepMessage, setSweepMessage] = useState("");
  const [pwaMessage, setPwaMessage] = useState("");
  const [canUndoSketch, setCanUndoSketch] = useState(false);
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

  useEffect(() => {
    const id = crypto.randomUUID();
    clientIdRef.current = id;
    setClientId(id);
    const roomFromLink = new URLSearchParams(window.location.hash.slice(1)).get("board");
    if (roomFromLink && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(roomFromLink)) {
      setRoomId(roomFromLink);
      const saved = readStoredBoard(roomFromLink);
      if (saved) setBoardDocument(saved);
    }
  }, []);

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
    setSamples(sweep.samples);
    setLastPlot({ samples: sweep.samples, driver: currentDriver, response: currentResponse });
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

  const updateStroke = useCallback((id: string, points: Point[], deleted: boolean) => {
    const currentClientId = clientIdRef.current;
    if (!currentClientId) return;
    setBoardDocument((current) => setStroke(current, id, points, deleted, currentClientId));
  }, []);

  const activateRoom = (id: string, restore = true) => {
    if (restore) {
      const saved = readStoredBoard(id);
      setBoardDocument(saved ?? createEmptyBoardDocument());
    }
    setRoomId(id);
    setShareMessage("");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#board=${id}`);
  };

  const createBoardLink = () => {
    if (!boardSyncConfigured) {
      setShareMessage("Live sharing is not configured on this deployment yet. Follow the Supabase setup in README.");
      return;
    }
    activateRoom(crypto.randomUUID(), false);
  };

  const joinBoard = () => {
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
    activateRoom(candidate);
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
      const { createBoardReport, svgToPng } = await import("../lib/board-report");
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
        sketchPng: canvas.toDataURL("image/png"),
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
        <a className="brand" href="/" aria-label="FBD Whiteboard">
          <span className="brand-mark">F</span>
          <span>FBD <strong>Whiteboard</strong></span>
        </a>
        <div className="toolbar-actions">
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
                  <button type="button" className="secondary-button" disabled={!boardSyncConfigured} onClick={createBoardLink}>Create share link</button>
                  <label className="share-link-label" htmlFor="join-board">Or join a board</label>
                  <input id="join-board" className="share-link-input" value={roomInput} onChange={(event) => setRoomInput(event.target.value)} placeholder="Paste link or board ID" />
                  <button type="button" className="quiet-button" disabled={!boardSyncConfigured} onClick={joinBoard}>Join board</button>
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
              <strong>Math input</strong>
              <p>Use <code>sqrt(x)</code>, <code>abs(x)</code>, or <code>|x|</code>. Trig functions use degrees. Length values assume inches; keep units consistent.</p>
            </div>
          </details>
        </div>
      </header>

      {pwaMessage && <p className="pwa-warning" role="status">{pwaMessage}</p>}

      <div className="board-split">
        <section className="board-pane sketch-pane" aria-label="Free body diagram">
          <div className="pane-toolbar">
            <h1>Diagram</h1>
            <div className="sketch-actions">
              <button className="quiet-button" type="button" disabled={!canUndoSketch} onClick={() => window.dispatchEvent(new Event("undo-sketch"))}>Undo</button>
              <button className="quiet-button" type="button" onClick={() => window.dispatchEvent(new Event("clear-sketch"))}>Clear</button>
            </div>
          </div>
          <DrawingPad
            label="Free body diagram sketch pad"
            onUndoStateChange={setCanUndoSketch}
            strokeRecords={boardDocument.strokes}
            onStrokeChange={updateStroke}
            reportCanvasRef={reportCanvasRef}
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
          <ResponsePlot samples={samples} driver={currentDriver} response={currentResponse} />
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
