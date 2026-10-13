"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { extractVariables, LinearEquation, MathInputError, parseEquations, solveSystem, SolveResult } from "../lib/math";

type Point = { x: number; y: number; pressure: number };
type Stroke = Point[];
type Tab = "sketch" | "equations";
type Sample = { driver: number; response: number };

function DrawingPad({ label, className = "" }: { label: string; className?: string }) {
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
    redraw();
  };

  return (
    <div className={`pad-shell ${className}`}>
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="drawing-canvas"
        onPointerDown={(event) => {
          event.preventDefault();
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
          redraw();
        }}
        onPointerCancel={() => {
          if (activeStrokeRef.current) {
            strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
            activeStrokeRef.current = null;
            setHasMarks(true);
            redraw();
          }
        }}
      />
      {!hasMarks && <div className="pad-placeholder" aria-hidden="true">Write or draw here with Apple Pencil</div>}
      <button className="pad-clear" onClick={clear} type="button">Clear</button>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 }).format(value);
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
  const width = 720;
  const height = 270;
  const padding = { top: 18, right: 20, bottom: 42, left: 64 };
  const xs = samples.map((sample) => sample.driver);
  const ys = samples.map((sample) => sample.response);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const x = (value: number) => padding.left + ((value - minX) / spanX) * (width - padding.left - padding.right);
  const y = (value: number) => height - padding.bottom - ((value - minY) / spanY) * (height - padding.top - padding.bottom);
  const points = samples.map((sample) => `${x(sample.driver)},${y(sample.response)}`).join(" ");
  return (
    <svg className="response-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${response} plotted against ${driver}`}>
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="plot-axis" />
      <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="plot-axis" />
      <line x1={padding.left} y1={padding.top + (height - padding.top - padding.bottom) / 2} x2={width - padding.right} y2={padding.top + (height - padding.top - padding.bottom) / 2} className="plot-grid" />
      <polyline points={points} className="plot-line" />
      <text x={padding.left} y={height - 12} className="plot-label">{formatNumber(minX)}</text>
      <text x={width - padding.right} y={height - 12} textAnchor="end" className="plot-label">{formatNumber(maxX)}</text>
      <text x={padding.left - 8} y={padding.top + 5} textAnchor="end" className="plot-label">{formatNumber(maxY)}</text>
      <text x={padding.left - 8} y={height - padding.bottom + 4} textAnchor="end" className="plot-label">{formatNumber(minY)}</text>
      <text x={width / 2} y={height - 1} textAnchor="middle" className="plot-label">{driver}</text>
      <text transform={`translate(15 ${height / 2}) rotate(-90)`} textAnchor="middle" className="plot-label">{response}</text>
    </svg>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("sketch");
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
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="FBD Equation Whiteboard home">
          <span className="brand-mark">F</span>
          <span>FBD <strong>Whiteboard</strong></span>
        </a>
        <div className="topbar-right">
          <span className="privacy-pill"><span /> Sketch stays on this device</span>
          <a className="help-link" href="#help">Help</a>
        </div>
      </header>

      <section className="intro">
        <div>
          <h1>Think it through.<br className="mobile-break" /> Solve it clearly.</h1>
          <p className="intro-copy">Sketch your free body diagram, then work through the equations—kept in their own space.</p>
        </div>
        <div className="workflow-note"><span>01</span> Sketch <i>→</i> <span>02</span> Equations <i>→</i> <span>03</span> Solve</div>
      </section>
      {pwaMessage && <p className="pwa-warning" role="status">{pwaMessage}</p>}

      <nav className="workspace-tabs" aria-label="Workspace">
        <button className={tab === "sketch" ? "tab active" : "tab"} onClick={() => setTab("sketch")} type="button">
          <span className="tab-number">01</span> Free body diagram
        </button>
        <button className={tab === "equations" ? "tab active" : "tab"} onClick={() => setTab("equations")} type="button">
          <span className="tab-number">02</span> Equations &amp; solve
          {variables.length > 0 && <span className="tab-count">{variables.length}</span>}
        </button>
        <span className="tab-spacer" />
        <span className="pencil-indicator"><span /> Pencil ready</span>
      </nav>

      <div className={tab === "sketch" ? "workspace-panel" : "workspace-panel is-hidden"} aria-hidden={tab !== "sketch"} inert={tab !== "sketch"}>
        <section className="canvas-card sketch-card">
          <div className="card-heading">
            <div>
              <h2>Free body diagram</h2>
            </div>
            <span className="local-badge">LOCAL ONLY</span>
          </div>
          <p className="card-description">Draw forces, supports, dimensions, and notes. Your sketch stays in this browser and is never uploaded.</p>
          <DrawingPad label="Free body diagram sketch pad" />
          <div className="canvas-footer">
            <span>Apple Pencil · touch · mouse</span>
            <span>Sketch data stays in this browser session</span>
          </div>
        </section>
        <aside className="side-note">
          <div className="note-icon">✳</div>
          <h3>Keep the picture separate.</h3>
          <p>Your diagram is a local drawing surface, separate from the equation editor. Switch tabs when you’re ready to enter the math.</p>
          <button className="primary-button" onClick={() => setTab("equations")} type="button">Continue to equations <span>→</span></button>
          <div className="note-divider" />
          <p className="small-note"><strong>Good to know</strong><br />Lines, arrows, and labels on this sketch will never leave this device.</p>
        </aside>
      </div>

      <div className={tab === "equations" ? "workspace-panel equation-layout" : "workspace-panel equation-layout is-hidden"} aria-hidden={tab !== "equations"} inert={tab !== "equations"}>
        <section className="canvas-card equation-editor-card">
          <div className="card-heading">
            <div>
              <h2>Write your equations</h2>
            </div>
            {variables.length > 0 && <span className="variable-count">{variables.length} variables</span>}
          </div>
          <p className="card-description">Type equations or use Apple Pencil Scribble in the field below. Scribble turns handwriting into editable text on your iPad; this app doesn’t upload your writing or need an OCR subscription.</p>
          <p className="scribble-tip"><strong>iPad tip:</strong> Enable Scribble under Settings → Apple Pencil → Scribble, tap the equation field, and write. Check the converted symbols and use one equation per line.</p>
          <label className="field-label" htmlFor="equations">Equations <span>on-device entry</span></label>
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
          {parsed.error && <p className="inline-message error" role="alert">{parsed.error}</p>}
          {parsed.equations.length > 0 && !parsed.error && (
            <div className="equation-preview" aria-label="Equation variable highlighting">
              <div className="preview-title">VARIABLE HIGHLIGHTS <span><i className="known-key" /> Known <i className="unknown-key" /> Unknown</span></div>
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
                <div><h3>Variables</h3><p>Mark measured or specified values as known.</p></div>
                <span>{unknowns.length} unknown · {parsed.equations.length} equations</span>
              </div>
              <div className="variable-list">
                {variables.map((name) => (
                  <div className={`variable-row ${known[name] ? "known-row" : ""}`} key={name}>
                    <span className={`variable-symbol ${known[name] ? "known-text" : "unknown-text"}`}>{name}</span>
                    <span className={`variable-status ${known[name] ? "known-status" : "unknown-status"}`}>{known[name] ? "KNOWN" : "UNKNOWN"}</span>
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
                          placeholder="value"
                        />
                      </label>
                    ) : <span className="variable-inferred">Solve for this</span>}
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
              {!enoughEquations && (
                <p className="inline-message warning" role="status">
                  System check: {parsed.equations.length} equation(s), {unknowns.length} unknown(s). At least as many independent equations as unknowns are required.
                </p>
              )}
              {knownNumericValues === null && <p className="inline-message warning">Enter a finite numeric value for each known variable to solve.</p>}
              <button className="solve-button" onClick={solve} disabled={!enoughEquations || !!parsed.error || knownNumericValues === null} type="button">
                Solve system <span>→</span>
              </button>
              {solveMessage && <p className="inline-message error" role="alert">{solveMessage}</p>}
              {result?.ok && (
                <div className="result-card" role="status">
                  <div className="result-heading"><span className="result-check">✓</span><div><strong>System solved</strong><small>Linear solution</small></div></div>
                  <div className="result-values">
                    {variables.map((name) => {
                      const value = known[name] ? knownNumericValues?.[name] : result.values[name];
                      return <div className="result-value" key={name}><span>{name}</span><strong>{value === undefined ? "—" : formatNumber(value)}</strong></div>;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="canvas-card sweep-card">
          <div className="card-heading">
            <div>
              <h2>Parameter sweep</h2>
            </div>
            <span className="local-badge">LOCAL SOLVE</span>
          </div>
          <p className="card-description">Vary one unknown across a range. The other unknowns are re-solved at each point.</p>
          {unknowns.length < 2 || parsed.error || !parsed.equations.length ? (
            <div className="empty-sweep">Add valid equations with at least two unknowns to explore a response.</div>
          ) : (
            <>
              <div className="sweep-controls">
                <label>Driving variable
                  <select value={currentDriver} onChange={(event) => { setDriver(event.target.value); setSamples(null); }}>
                    {unknowns.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <label>Driven variable
                  <select value={currentResponse} onChange={(event) => { setResponse(event.target.value); setSamples(null); }}>
                    {unknowns.filter((name) => name !== currentDriver).map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              </div>
              <div className="range-controls">
                <label>From <input inputMode="decimal" value={rangeStart} onChange={(event) => { setRangeStart(event.target.value); setSamples(null); setSweepMessage(""); }} /></label>
                <label>To <input inputMode="decimal" value={rangeEnd} onChange={(event) => { setRangeEnd(event.target.value); setSamples(null); setSweepMessage(""); }} /></label>
                <label>Samples <input inputMode="numeric" type="number" min="2" max="101" value={sampleCount} onChange={(event) => { setSampleCount(event.target.value); setSamples(null); setSweepMessage(""); }} /></label>
              </div>
              <button className="secondary-button" onClick={runSweep} type="button">Generate table &amp; plot <span>↗</span></button>
              {sweepMessage && <p className="inline-message error" role="alert">{sweepMessage}</p>}
              {samples && (
                <div className="sweep-results" aria-live="polite">
                  <ResponsePlot samples={samples} driver={currentDriver} response={currentResponse} />
                  <div className="sample-table-wrap">
                    <table>
                      <thead><tr><th>{currentDriver}</th><th>{currentResponse}</th></tr></thead>
                      <tbody>{samples.map((sample, index) => <tr key={`${index}-${sample.driver}`}><td>{formatNumber(sample.driver)}</td><td>{formatNumber(sample.response)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <footer id="help" className="footer">
        <span>FBD Whiteboard <span className="footer-dot">·</span> Built for mechanical reasoning</span>
        <span>Linear systems only <span className="footer-dot">·</span> Nonlinear equations are flagged, never guessed</span>
      </footer>
    </main>
  );
}
