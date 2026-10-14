"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { extractVariables, LinearEquation, MathInputError, parseEquations, solveSystem, SolveResult } from "../lib/math";

type Point = { x: number; y: number; pressure: number };
type Stroke = Point[];
type Sample = { driver: number; response: number };

function DrawingPad({
  label,
  className = "",
  onUndoStateChange,
}: {
  label: string;
  className?: string;
  onUndoStateChange: (available: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const [hasMarks, setHasMarks] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#172b4d";
    context.lineCap = "round";
    context.lineJoin = "round";
    const strokes = [...strokesRef.current, ...(activeStrokeRef.current ? [activeStrokeRef.current] : [])];
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
    strokesRef.current = [];
    activeStrokeRef.current = null;
    setHasMarks(false);
    onUndoStateChange(false);
    redraw();
  };

  const undo = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setHasMarks(strokesRef.current.length > 0);
    onUndoStateChange(strokesRef.current.length > 0);
    redraw();
  };

  useEffect(() => {
    window.addEventListener("clear-sketch", clear);
    window.addEventListener("undo-sketch", undo);
    return () => {
      window.removeEventListener("clear-sketch", clear);
      window.removeEventListener("undo-sketch", undo);
    };
  }, [onUndoStateChange, redraw]);

  return (
    <div className={`pad-shell ${className}`}>
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="drawing-canvas"
        onPointerDown={(event) => {
          event.preventDefault();
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          activeStrokeRef.current = [pointFromEvent(event)];
          redraw();
        }}
        onPointerMove={(event) => {
          if (!activeStrokeRef.current) return;
          event.preventDefault();
          activeStrokeRef.current.push(pointFromEvent(event));
          redraw();
        }}
        onPointerUp={(event) => {
          if (!activeStrokeRef.current) return;
          strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
          activeStrokeRef.current = null;
          setHasMarks(true);
          onUndoStateChange(true);
          redraw();
        }}
        onPointerCancel={() => {
          if (activeStrokeRef.current) {
            strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
            activeStrokeRef.current = null;
            setHasMarks(true);
            onUndoStateChange(true);
            redraw();
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
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

function HighlightedEquation({ equation, variables, known }: {
  equation: string;
  variables: string[];
  known: Record<string, boolean>;
}) {
  const names = [...variables].sort((a, b) => b.length - a.length);
  const regex = names.length ? new RegExp(`(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gu") : null;
  const parts = regex ? equation.split(regex) : [equation];
  return (
    <code className="highlighted-equation">
      {parts.map((part, index) => variables.includes(part)
        ? <span className={known[part] ? "known-text" : "unknown-text"} key={`${part}-${index}`}>{part}</span>
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

function ResponsePlot({ samples, driver, response }: { samples: Sample[]; driver: string; response: string }) {
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
    <svg className="response-plot" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${response} plotted against ${driver}`}>
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
  const [equationText, setEquationText] = useState("");
  const [known, setKnown] = useState<Record<string, boolean>>({});
  const [knownValues, setKnownValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SolveResult | null>(null);
  const [solveMessage, setSolveMessage] = useState("");
  const [driver, setDriver] = useState("");
  const [response, setResponse] = useState("");
  const [rangeStart, setRangeStart] = useState("0");
  const [rangeEnd, setRangeEnd] = useState("10");
  const [sampleCount, setSampleCount] = useState("21");
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [sweepMessage, setSweepMessage] = useState("");
  const [pwaMessage, setPwaMessage] = useState("");
  const [canUndoSketch, setCanUndoSketch] = useState(false);

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
  const unknowns = variables.filter((name) => !known[name]);
  const currentDriver = driver && unknowns.includes(driver) ? driver : unknowns[0] ?? "";
  const currentResponse = response && unknowns.includes(response) && response !== currentDriver
    ? response
    : unknowns.find((name) => name !== currentDriver) ?? "";
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
  const enoughEquations = parsed.equations.length >= unknowns.length;

  const solve = () => {
    setResult(null);
    setSolveMessage("");
    setSamples(null);
    if (!parsed.equations.length || parsed.error) {
      setSolveMessage(parsed.error || "Add at least one valid equation before solving.");
      return;
    }
    if (knownNumericValues === null) {
      setSolveMessage("Enter a finite numeric value for every variable marked known.");
      return;
    }
    const solved = solveSystem(parsed.equations, unknowns, knownNumericValues);
    setResult(solved);
    if (!solved.ok) setSolveMessage(solved.message);
  };

  const runSweep = () => {
    setSamples(null);
    setSweepMessage("");
    if (knownNumericValues === null) {
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
    const sweep = buildSamples(parsed.equations, unknowns, knownNumericValues, currentDriver, currentResponse, start, end, count);
    if (!sweep.samples) {
      setSweepMessage(sweep.error ?? "The parameter sweep could not be computed.");
      return;
    }
    setSamples(sweep.samples);
  };

  useEffect(() => {
    if (!samples) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSamples(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [samples]);

  const updateEquations = (value: string) => {
    setEquationText(value);
    setResult(null);
    setSamples(null);
    setKnown({});
    setKnownValues({});
    setSolveMessage("");
    setSweepMessage("");
  };

  return (
    <main className="whiteboard">
      <header className="board-toolbar">
        <a className="brand" href="/" aria-label="FBD Whiteboard">
          <span className="brand-mark">F</span>
          <span>FBD <strong>Whiteboard</strong></span>
        </a>
        <div className="toolbar-actions">
          <span className="local-indicator"><span /> Local</span>
          <details className="help-menu">
            <summary aria-label="Help" title="Help">?</summary>
            <div className="help-popover">
              <strong>Apple Pencil</strong>
              <p>Turn on Scribble in Settings → Apple Pencil. Write one equation per line, then check the text.</p>
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
          <DrawingPad label="Free body diagram sketch pad" onUndoStateChange={setCanUndoSketch} />
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
                <div className="preview-title"><span><i className="known-key" /> Known <i className="unknown-key" /> Unknown</span></div>
                {parsed.equations.map((equation, index) => (
                  <div className="preview-equation" key={`${index}-${equation.source}`}>
                    <span className="equation-index">{index + 1}</span>
                    <HighlightedEquation equation={equation.source} variables={variables} known={known} />
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
                    <div className={`variable-row ${known[name] ? "known-row" : ""}`} key={name}>
                      <span className={`variable-symbol ${known[name] ? "known-text" : "unknown-text"}`}>{name}</span>
                      {known[name] ? (
                        <label className="known-input-wrap">
                          <span className="sr-only">{name} known value</span>
                          <input
                            inputMode="decimal"
                            value={knownValues[name] ?? ""}
                            onChange={(event) => {
                              setKnownValues((previous) => ({ ...previous, [name]: event.target.value }));
                              setResult(null);
                              setSamples(null);
                              setSolveMessage("");
                              setSweepMessage("");
                            }}
                            placeholder="Value"
                          />
                        </label>
                      ) : <span className="variable-inferred">Unknown</span>}
                      <button
                        className="known-toggle"
                        type="button"
                        aria-label={known[name] ? `Mark ${name} unknown` : `Mark ${name} known`}
                        aria-pressed={!!known[name]}
                        onClick={() => {
                          setKnown((previous) => ({ ...previous, [name]: !previous[name] }));
                          setResult(null);
                          setSamples(null);
                          setSolveMessage("");
                          setSweepMessage("");
                        }}
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
                    const value = known[name] ? knownNumericValues?.[name] : result.values[name];
                    return <div className="result-value" key={name}><span className={known[name] ? "known-text" : "unknown-text"}>{name}</span><strong>{value === undefined ? "—" : formatNumber(value)}</strong></div>;
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
    </main>
  );
}
