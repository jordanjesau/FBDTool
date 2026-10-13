import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024) {
    return NextResponse.json({ error: "Equation image must be no larger than 8 MB." }, { status: 413 });
  }
  const appId = process.env.MATHPIX_APP_ID;
  const appKey = process.env.MATHPIX_APP_KEY;
  if (!appId || !appKey) {
    return NextResponse.json(
      { error: "Equation recognition is not configured. Add MATHPIX_APP_ID and MATHPIX_APP_KEY on the server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const image = typeof body === "object" && body !== null && "image" in body
    ? (body as { image?: unknown }).image
    : undefined;
  const consent = typeof body === "object" && body !== null && "consent" in body
    ? (body as { consent?: unknown }).consent
    : undefined;
  if (consent !== true) {
    return NextResponse.json({ error: "Confirm the equation handwriting upload disclosure before recognition." }, { status: 400 });
  }
  if (typeof image !== "string") {
    return NextResponse.json({ error: "Provide an equation-pad image to recognize." }, { status: 400 });
  }
  const match = IMAGE_DATA_URL.exec(image);
  if (!match) {
    return NextResponse.json({ error: "Equation image must be a base64 PNG, JPEG, or WebP image." }, { status: 400 });
  }
  if (match[1].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    return NextResponse.json({ error: "Equation image must be no larger than 8 MB." }, { status: 413 });
  }
  const imageBytes = Buffer.from(match[1], "base64");
  if (imageBytes.byteLength === 0 || imageBytes.toString("base64") !== match[1]) {
    return NextResponse.json({ error: "Equation image must contain valid, non-empty base64 data." }, { status: 400 });
  }
  if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Equation image must be non-empty and no larger than 8 MB." }, { status: 413 });
  }

  let response: Response;
  try {
    response = await fetch("https://api.mathpix.com/v3/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        app_id: appId,
        app_key: appKey,
      },
      body: JSON.stringify({
        src: image,
        formats: ["text"],
        data_options: { include_asciimath: true },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the handwriting recognition service. Check the server connection and retry." }, { status: 502 });
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const providerError = typeof result === "object" && result !== null && "error" in result
      && typeof (result as { error?: unknown }).error === "string"
      ? (result as { error: string }).error
      : `The recognition service returned HTTP ${response.status}.`;
    return NextResponse.json({ error: `Equation recognition failed: ${providerError}` }, { status: 502 });
  }

  const text = typeof result === "object" && result !== null && "text" in result
    && typeof (result as { text?: unknown }).text === "string"
    ? (result as { text: string }).text
    : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "No equation text was recognized. Write clearly and try again." }, { status: 422 });
  }
  return NextResponse.json({ text });
}
