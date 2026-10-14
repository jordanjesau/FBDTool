import { jsPDF } from "jspdf";

export type ReportVariable = {
  name: string;
  known: boolean;
  calculated?: boolean;
  value: string;
};

export type BoardReport = {
  title: string;
  generatedAt: Date;
  equations: string;
  variables: ReportVariable[];
  parseError?: string;
  sketchPng: string;
  plot?: {
    png: string;
    driver: string;
    response: string;
  };
};

type ReportLine = { text: string; color: [number, number, number] };

const ink: [number, number, number] = [23, 43, 77];
const muted: [number, number, number] = [101, 117, 138];
const green: [number, number, number] = [24, 132, 91];
const magenta: [number, number, number] = [191, 23, 110];

function fitImage(
  doc: jsPDF,
  data: string,
  box: { x: number; y: number; width: number; height: number },
) {
  const image = doc.getImageProperties(data);
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  doc.addImage(data, "PNG", box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
}

export type PixelBounds = { x: number; y: number; width: number; height: number };

export function findSketchBounds(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}, paddingRatio = 0.08): PixelBounds | null {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;

  const drawingWidth = right - left + 1;
  const drawingHeight = bottom - top + 1;
  const padding = Math.max(6, Math.ceil(Math.max(drawingWidth, drawingHeight) * paddingRatio));
  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  const endX = Math.min(image.width, right + padding + 1);
  const endY = Math.min(image.height, bottom + padding + 1);
  return { x, y, width: endX - x, height: endY - y };
}

export function cropSketchToPng(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not read the diagram for the PDF.");

  const bounds = findSketchBounds(context.getImageData(0, 0, canvas.width, canvas.height));
  if (!bounds) return canvas.toDataURL("image/png");

  const cropped = document.createElement("canvas");
  cropped.width = bounds.width;
  cropped.height = bounds.height;
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) throw new Error("Could not prepare the diagram for the PDF.");
  croppedContext.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return cropped.toDataURL("image/png");
}

function wrappedLines(doc: jsPDF, items: ReportLine[], width: number, fontSize: number) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);
  return items.map((item) => ({ ...item, lines: doc.splitTextToSize(item.text, width) as string[] }));
}

function drawFittingLines(doc: jsPDF, items: ReportLine[], x: number, top: number, width: number, bottom: number) {
  for (let fontSize = 9; fontSize >= 5.5; fontSize -= 0.5) {
    const wrapped = wrappedLines(doc, items, width, fontSize);
    const lineHeight = fontSize * 1.32;
    const height = wrapped.reduce((total, item) => total + item.lines.length * lineHeight, 0);
    if (top + height > bottom) continue;

    let y = top + fontSize;
    for (const item of wrapped) {
      doc.setTextColor(...item.color);
      doc.text(item.lines, x, y, { lineHeightFactor: 1.32 });
      y += item.lines.length * lineHeight;
    }
    doc.setTextColor(...ink);
    return;
  }
  throw new Error("This report is too long for one page. Shorten the equations or reduce the number of variables, then try again.");
}

export function createBoardReport(report: BoardReport): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 30;
  const contentWidth = pageWidth - margin * 2;

  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  const title = report.title.trim() || "Untitled Mechanics Report";
  const titleSize = Math.min(20, 20 * contentWidth / Math.max(contentWidth, doc.getTextWidth(title)));
  doc.setFontSize(titleSize);
  doc.text(title, margin, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(`Generated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(report.generatedAt)}`, margin, 51);
  doc.setDrawColor(225, 231, 239);
  doc.line(margin, 62, pageWidth - margin, 62);

  const panelTop = 83;
  const panelHeight = 190;
  const panelGap = 14;
  const panelWidth = report.plot ? (contentWidth - panelGap) / 2 : contentWidth;
  const diagramX = margin;
  const diagramImageBox = { x: diagramX + 8, y: panelTop + 17, width: panelWidth - 16, height: panelHeight - 25 };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...ink);
  doc.text("Free-body diagram", diagramX, 78);
  doc.setDrawColor(225, 231, 239);
  doc.roundedRect(diagramX, panelTop, panelWidth, panelHeight, 4, 4, "S");
  fitImage(doc, report.sketchPng, diagramImageBox);

  if (report.plot) {
    const plotX = margin + panelWidth + panelGap;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ink);
    doc.text(`${report.plot.response} vs. ${report.plot.driver}`, plotX, 78);
    doc.setDrawColor(225, 231, 239);
    doc.roundedRect(plotX, panelTop, panelWidth, panelHeight, 4, 4, "S");
    fitImage(doc, report.plot.png, {
      x: plotX + 8,
      y: panelTop + 8,
      width: panelWidth - 16,
      height: panelHeight - 16,
    });
  }

  const sectionsTop = 294;
  const sectionBottom = pageHeight - margin;
  const columnGap = 18;
  const equationsWidth = contentWidth * 0.59;
  const variablesX = margin + equationsWidth + columnGap;
  const variablesWidth = pageWidth - margin - variablesX;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(`Equations (${report.equations.split(/\r?\n/).filter((line) => line.trim()).length})`, margin, sectionsTop);
  doc.text(`Variables (${report.variables.length})`, variablesX, sectionsTop);
  doc.setDrawColor(225, 231, 239);
  doc.line(margin + equationsWidth + columnGap / 2, sectionsTop - 8, margin + equationsWidth + columnGap / 2, sectionBottom);

  const equationItems: ReportLine[] = report.equations
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => ({ text: `${index + 1}. ${line.trim()}`, color: ink }));
  if (equationItems.length === 0) equationItems.push({ text: "No equations entered.", color: muted });
  if (report.parseError) equationItems.push({ text: `Equation warning: ${report.parseError}`, color: [130, 86, 14] });
  drawFittingLines(doc, equationItems, margin, sectionsTop + 7, equationsWidth - 8, sectionBottom);

  const variableItems: ReportLine[] = report.variables.map((variable) => {
    const color: ReportLine["color"] = variable.known ? green : variable.calculated ? [24, 90, 219] : magenta;
    const description = variable.known
      ? `${variable.name} = ${variable.value.trim() || "value not entered"} (known)`
      : variable.calculated
        ? `${variable.name} = ${variable.value.trim()} (calculated)`
      : `${variable.name} (unknown)`;
    return { text: description, color };
  });
  if (variableItems.length === 0) variableItems.push({ text: "No variables detected.", color: muted });
  drawFittingLines(doc, variableItems, variablesX, sectionsTop + 7, variablesWidth, sectionBottom);

  return doc;
}

export async function svgToPng(svg: SVGSVGElement): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "2400");
  clone.setAttribute("height", "1520");

  const sourceNodes = [svg, ...svg.querySelectorAll("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll("*")];
  const inlineProperties = [
    "fill",
    "stroke",
    "stroke-width",
    "font-family",
    "font-size",
    "font-weight",
    "stroke-linecap",
    "stroke-linejoin",
    "text-anchor",
  ];
  sourceNodes.forEach((source, index) => {
    const target = cloneNodes[index] as SVGElement;
    const computed = window.getComputedStyle(source);
    for (const property of inlineProperties) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });

  const objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1520;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the plot image for the PDF.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
