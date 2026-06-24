# P0 perf baseline (v0.16.0)

The recorded perf floor the per-frame phases (P10a to P14b) regress against. P0 only
RECORDS this; it does not gate against it (there is no prior baseline to beat). perf_tour
itself is NOT re-authored in P0 (its re-author is P17a); this phase only ran it.

## How the numbers are framed (read this first)

Two different kinds of number live here, and they are NOT compared the same way:

- **`hudHotDomSkipRate` is the DURABLE anchor.** It is a ratio (skipped hot-DOM writes /
  total hot-DOM writes), so it is machine-independent: it measures how often the HUD's
  write-elision cache avoided a redundant DOM write, which does not depend on CPU/GPU
  speed. Every per-frame phase asserts this skip-rate has not DROPPED versus this baseline.
  This is the number that travels.
- **`frameP95` and `inputIntentToFrameP95` are SAME-MACHINE-RELATIVE only.** They are
  wall-clock milliseconds and do NOT travel across hardware. They were captured under
  headless Chrome with software WebGL (`--use-angle=swiftshader`), which renders at roughly
  1 to 2 fps, so the absolute ms below are dominated by software rasterization, not by HUD
  cost. A later phase compares them against a FRESH same-machine re-run of THIS baseline
  (re-run the exact command below on the same hardware, then diff), never against the
  literal P0 ms on different hardware or a different renderer.

## Prerequisite (exact)

perf_tour drives a real browser against the OFFLINE client only. It needs:

- `npm run dev` (Vite) listening on **http://localhost:5173**. That is the ONLY process
  required: perf_tour boots the offline `Sim` (clicks `#btn-offline`, names a character,
  picks warrior, clicks `#btn-start-offline`), so **`npm run server` / :8787 is NOT needed**
  and no Postgres is needed.
- A Chromium-family browser resolved by `scripts/browser_path.mjs` (here:
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). Launched `headless: 'new'`
  with `--use-angle=swiftshader --enable-unsafe-swiftshader`.

## Exact command + flags

```sh
# desktop profile (1600x900, deviceScaleFactor 1, non-touch):
PERF_VIEWPORT=desktop node scripts/perf_tour.mjs
# (optional) pin the JSON output path:
PERF_OUT=/path/to/perf-tour-desktop.json PERF_VIEWPORT=desktop node scripts/perf_tour.mjs
```

`PERF_VIEWPORT` selects the profile: `desktop`, `mobile`, or `both` (default). Other
relevant defaults: `GAME_URL=http://localhost:5173`, `PERF_SCENARIO=bench_perf_tour`,
`PERF_STEP_MS=2500`, `PERF_SETTLE_MS=600`, `PERF_BOOT_TIMEOUT_MS=120000`. No `PERF_MAX_*`
threshold was set, so the run records numbers without failing on a budget.

## Machine spec (because absolute ms is not portable)

| Field | Value |
|---|---|
| CPU | Apple M4 Max |
| Cores | 16 logical / 16 physical |
| RAM | 128 GB |
| OS | macOS 26.5.1 (arm64) |
| Node | v24.15.0 |
| Browser | Google Chrome 149.0.7827.196, headless, ANGLE swiftshader (software WebGL) |
| Captured | 2026-06-24 |

## Recorded floor

### desktop (1600x900): CAPTURED

| Metric | Value | Role |
|---|---|---|
| **hudHotDomSkipRate** | **0.962** (38 hot writes / 950 skipped, 988 total) | DURABLE anchor: per-frame phases assert skip-rate does not drop below this |
| frameP95 | 250 ms | same-machine-relative only |
| inputIntentToFrameP95 | 652.7 ms | same-machine-relative only |
| inputIntentToVisibleP95 | 658.2 ms | same-machine-relative only |
| fps (full / last 10s) | 1.29 / 1.58 | software-WebGL artifact, recorded for context only |
| rendererTier | ultra | |
| bootMiB | 68.779 | |
| gltf / textures / views | 150 / 51 / 46 | |
| samples / errors | 6 / 0 | |

### mobile (390x844): NOT CAPTURABLE on the untouched tree (surfaced finding, deferred to P17a)

perf_tour's mobile profile **cannot boot the world** on v0.16.0 as shipped, so there is no
mobile number to record (it was NOT fabricated). Root cause, two compounding reasons:

1. The mobile profile viewport is **390x844 (portrait)**. On v0.16.0 the in-game world is
   **landscape-only on web mobile (decision 16a)**, so a portrait mobile viewport surfaces
   the rotate / preflight gate instead of the HUD.
2. perf_tour's `bootOffline` flow does **not dismiss the `#mobile-preflight` overlay**
   (`body` stays `mobile-preflight-open`, `window.__game.sim.player` never appears), so the
   boot wait times out after 120s (`hasGame: false`).

Editing perf_tour to fix this is OUT of P0 scope (re-author is P17a). **P17a must give the
mobile perf profile a landscape viewport AND dismiss the preflight** so a mobile perf floor
can be captured; until then the per-frame phases can only gate the DESKTOP frameP95 and the
machine-independent hudHotDomSkipRate. The skip-rate anchor is renderer-independent, so the
per-frame DOM-write gate still holds for both profiles via the desktop capture; only the
mobile wall-clock floor is deferred.

## What later phases do with this

- P10a to P14b: assert `hudHotDomSkipRate >= 0.962` (the durable gate) and `frameP95 <=` a
  fresh same-machine re-run of this desktop baseline (NOT <= the literal 250 ms on other
  hardware). Re-run `PERF_VIEWPORT=desktop node scripts/perf_tour.mjs` on the gating machine
  to get the comparison number.
- P17a: re-author perf_tour (incl. a working landscape mobile profile) and add the standing
  `hud_perf_budget.test.ts`.
