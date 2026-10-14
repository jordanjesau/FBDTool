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

1. Draw forces, supports, dimensions, and notes in the **Diagram** pane; use **Undo** to remove the last stroke or **Clear** to erase the sketch. It stays in the browser unless you enable live sharing, which sends sketch strokes to your configured Supabase project.
2. In the **Equations** pane, type or write equations with Apple Pencil using iPadOS Scribble. If needed, turn Scribble on in **Settings → Apple Pencil → Scribble**. Scribble converts handwriting into editable text on the iPad; this app does not perform handwriting-image OCR.
3. Enter one equation per line, with exactly one `=` per equation. Names such as `Fx`, `theta`, and `x_1` are each a single variable. Use `sqrt(x)` for a square root, `abs(x)` or vertical bars (`|x|`) for absolute value. For example, `sqrt(x)=3` means the square root of `x` is 3; `|Fx|=12` means the absolute value of the whole variable `Fx` is 12. Multiplication may be explicit (`2*x`) or implicit (`2x`); use `*` between two variable expressions (`x*y`). Supported functions also include `exp`, `ln`, `log`, `log10`, and common trigonometric and hyperbolic functions. Trigonometric inputs and inverse-trigonometric results use degrees, so `sin(30)=0.5`. Length values are assumed to be inches; the app does not convert units, so keep equations and known values consistent. The app solves linear systems directly and uses a numerical solver for nonlinear systems. Nonlinear solves can report multiple roots, non-convergence, or numerical instability instead of choosing an arbitrary answer.
4. Mark measured variables as **Known** and enter finite numeric values. A unique solution needs at least as many equations as remaining unknowns. Contradictory, underdetermined, and numerically ill-conditioned systems are reported rather than given invented results.
5. For a parameter sweep, choose an unknown driving variable, an unknown response, a finite increasing range, and 2–101 samples. The app re-solves the remaining system at each sample and opens a full-screen, gridded plot with axis ticks and a results table.

This app has no subscription or paid recognition service. Scribble is an iPad feature; on desktop, type directly into the equation field. Solving, known-value tracking, plotting, and sweeps run locally. The app does not send content to an OCR provider; when you enable sharing, board contents are sent to your configured Supabase Realtime project for live synchronization.

## Sharing across devices

Live sharing uses Supabase Realtime. Both devices need an internet connection and the same private board link open. Equation text, known-variable choices and values, and sketch strokes synchronize while the board is online. The app also keeps a local copy in each browser. The Realtime channel is transient: if every device leaves, a newly opened device cannot download the board from Supabase; reopen it on a device that has its local copy and join from the other device. No app account or database tables are required; this uses public Realtime channels. Supabase free-plan limits apply.

To enable sharing:

1. Create a free project at [supabase.com](https://supabase.com/).
2. In the Supabase project settings, copy the **Project URL** and the public **anon / publishable key**. The browser key is intended to be public; never use a `service_role` key.
3. For local development, copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Restart `npm run dev`.
4. In Vercel, open the project **Settings → Environment Variables**, add the same two variables for Production (and Preview if needed), then redeploy.
5. Open the app, choose **Share → Create share link**, then open or paste that link on the other device. The toolbar shows **Sync ready** for one connected device and the connected device count when another joins. Updates larger than 180,000 bytes are rejected with an on-screen error.

Anyone who has the share link can view and edit that board. Treat it like a private invite link and do not put sensitive information in it. **Leave room** disconnects only this device; this version cannot revoke an existing link, so anyone who still has it can reconnect. Local copies remain on each device.

## Deploy

Recommended: deploy as a **Next.js app on Vercel**, or use another host that supports Next.js. No Mathpix or other recognition credentials are needed. Use HTTPS for installability. Vercel plan eligibility and limits are controlled by Vercel and may change.

For Vercel, set **Framework Preset** to **Next.js**, **Root Directory** to the repository root, and leave any **Output Directory** override blank so Vercel uses Next.js output. The project must deploy as a Next.js app, not as a static `public` directory.

The manifest and service worker provide app-shell caching. On iPad, open the HTTPS site in Safari, tap **Share → Add to Home Screen**, then launch it from the Home Screen.

## Checks

```sh
npm test
npm run build
```
