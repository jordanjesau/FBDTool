# FBD Equation Whiteboard

A standalone, iPad-friendly workspace for free body diagram sketches, equation entry, equation solving, and parameter sweeps. All app features run in the browser; there is no paid OCR, Mathpix account, or API key.

## Run locally

Requirements: Node.js 20.9 or newer and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:3000`.

## Use on iPad

1. Draw forces, supports, dimensions, and notes in the **Diagram** pane; use **Undo** to remove the last stroke or **Clear** to erase the sketch. The sketch stays in the browser and is never uploaded.
2. In the **Equations** pane, type or write equations with Apple Pencil using iPadOS Scribble. If needed, turn Scribble on in **Settings → Apple Pencil → Scribble**. Scribble converts handwriting into editable text on the iPad; this app does not perform handwriting-image OCR.
3. Enter one equation per line, with exactly one `=` per equation. Names such as `Fx`, `theta`, and `x_1` are each a single variable. Supported syntax includes `+ - * / ^`, parentheses, implicit multiplication such as `2x`, and `sqrt`, `exp`, `ln`, `log`, `log10`, and common trigonometric and hyperbolic functions. The app solves linear systems directly and uses a numerical solver for nonlinear systems. Nonlinear solves can report multiple roots, non-convergence, or numerical instability instead of choosing an arbitrary answer.
4. Mark measured variables as **Known** and enter finite numeric values. A unique solution needs at least as many equations as remaining unknowns. Contradictory, underdetermined, and numerically ill-conditioned systems are reported rather than given invented results.
5. For a parameter sweep, choose an unknown driving variable, an unknown response, a finite increasing range, and 2–101 samples. The app re-solves the remaining system at each sample and opens a full-screen, gridded plot with axis ticks and a results table.

This app has no subscription or paid recognition service. Scribble is an iPad feature; on desktop, type directly into the equation field. Solving, known-value tracking, plotting, and sweeps run locally. The sketch and equation text are not sent to an OCR provider.

## Deploy

Recommended: deploy as a **Next.js app on Vercel**, or use another host that supports Next.js. No Mathpix or other recognition credentials are needed. Use HTTPS for installability. Vercel plan eligibility and limits are controlled by Vercel and may change.

For Vercel, set **Framework Preset** to **Next.js**, **Root Directory** to the repository root, and leave any **Output Directory** override blank so Vercel uses Next.js output. The project must deploy as a Next.js app, not as a static `public` directory.

The manifest and service worker provide app-shell caching. On iPad, open the HTTPS site in Safari, tap **Share → Add to Home Screen**, then launch it from the Home Screen.

## Checks

```sh
npm test
npm run build
```
