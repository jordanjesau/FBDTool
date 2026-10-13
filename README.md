# FBD Equation Whiteboard

A standalone, iPad-friendly web workspace for free body diagram sketches, equation handwriting recognition, linear-system solving, and parameter sweeps. The sketch canvas and equation pad are separate: only the equation pad image is sent to the OCR provider.

## Requirements

- Node.js 20.9 or newer and npm
- A Mathpix account and API credentials for handwriting recognition

## Run locally

```sh
npm install
```

Copy `.env.example` to `.env.local` using your shell (for example, `Copy-Item .env.example .env.local` in PowerShell), then set `MATHPIX_APP_ID` and `MATHPIX_APP_KEY` in `.env.local` before starting the app:

```sh
npm run dev
```

Open `http://localhost:3000`. Without the Mathpix credentials, typed equations and the local solver still work; handwriting recognition responds with a clear server-configuration error.

## Use

1. Draw the free body diagram on the **Free body diagram** tab. The sketch stays in the current browser session and is never sent to OCR.
2. On **Equations & solve**, write equations on the separate handwriting pad. Accept the visible Mathpix disclosure and select **Recognize handwriting**. Recognition uploads only that equation-pad image to the app's server route, which forwards it to Mathpix.
3. Review and correct the recognized equations, or type them directly in the editable equation field. Use one equation per line and exactly one `=` per equation. Supported syntax includes names such as `Fx`, `theta`, and `x_1`; arithmetic `+ - * / ^`; parentheses; and implicit multiplication such as `2x`. Keep each equation linear in its variables. Nonlinear operations, malformed input, and division by zero are reported rather than evaluated.
4. Mark measured variables as **Known** and enter finite numeric values. A unique solution needs at least as many independent equations as remaining unknowns. A square system is solved directly; extra equations after known values are substituted are checked for consistency. Singular, contradictory, underdetermined, and numerically ill-conditioned systems are reported without displaying invented values.
5. For a parameter sweep, select an unknown driving variable, an unknown response variable, a finite increasing range, and 2–101 samples. The system is re-solved at every sample; if any point cannot be solved, the app reports the first failure instead of showing partial or misleading results.

All solving, variable tracking, plotting, and sweep calculations run locally in the browser. Only handwriting sent after the explicit disclosure is uploaded; the app does not store or log the image.

## Deploy

Recommended: deploy as a **Node.js Next.js app on Vercel** (or another Next.js host that supports server route handlers), with HTTPS enabled. In the deployment's server-side environment settings, configure `MATHPIX_APP_ID` and `MATHPIX_APP_KEY`; do not add these credentials to client-side variables or commit them. The `/api/recognize` route keeps them on the server. Redeploy after setting or rotating credentials.

The web manifest and service worker provide installable app metadata and a cached shell. Production deployment must use HTTPS (localhost is also secure for development). On iPad Safari, open the deployed HTTPS URL, tap **Share**, then **Add to Home Screen**. The app can still be used without installation.

## Checks

```sh
npm test
npm run build
```
