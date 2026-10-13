import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/recognize/route";

function request(body: string): Request {
  return new Request("http://localhost/api/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("handwriting recognition route", () => {
  it("returns a clear setup error if server credentials are absent", async () => {
    vi.stubEnv("MATHPIX_APP_ID", "");
    vi.stubEnv("MATHPIX_APP_KEY", "");
    const response = await POST(request(JSON.stringify({ image: "data:image/png;base64,aGVsbG8=", consent: true })));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("MATHPIX_APP_ID") });
  });

  it("rejects malformed JSON and invalid image input before contacting the provider", async () => {
    vi.stubEnv("MATHPIX_APP_ID", "test-id");
    vi.stubEnv("MATHPIX_APP_KEY", "test-key");
    const providerFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", providerFetch);
    const invalidJson = await POST(request("{"));
    const missingConsent = await POST(request(JSON.stringify({ image: "data:image/png;base64,aGVsbG8=" })));
    const invalidImage = await POST(request(JSON.stringify({ image: "data:image/png;base64,not-valid===", consent: true })));
    expect(invalidJson.status).toBe(400);
    expect(missingConsent.status).toBe(400);
    expect(invalidImage.status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("forwards only the submitted equation image with server-side credentials", async () => {
    vi.stubEnv("MATHPIX_APP_ID", "server-id");
    vi.stubEnv("MATHPIX_APP_KEY", "server-key");
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: "F = m*a" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", providerFetch);
    const response = await POST(request(JSON.stringify({ image: "data:image/png;base64,aGVsbG8=", consent: true })));
    const [url, options] = providerFetch.mock.calls[0];
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "F = m*a" });
    expect(url).toBe("https://api.mathpix.com/v3/text");
    expect(options?.headers).toMatchObject({ app_id: "server-id", app_key: "server-key" });
    expect(JSON.parse(String(options?.body))).toMatchObject({ src: "data:image/png;base64,aGVsbG8=" });
  });
});
