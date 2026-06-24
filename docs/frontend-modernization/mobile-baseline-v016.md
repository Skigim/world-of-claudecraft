# P0 mobile-layout baseline (v0.16.0)

The blocking RESPONSIVE floor P4a / P4b and the per-frame phases gate against (decision 16).
`css_corpus` is layout-blind, so the six V16 `mobile_*` E2E scripts are the responsive net.
P0 only RUNS and RECORDS their current state on the untouched green tree; it edits none of
them (wiring them as a blocking row is P4a / P4b's job).

## Prerequisite (exact)

- `npm run dev` (Vite) on **http://localhost:5173** (offline `Sim`; no server, no Postgres).
  Note the port drift below: `mobile_chat_safe_area` defaults to **:5174**, so it was run with
  `GAME_URL=http://localhost:5173`.
- A Chromium-family browser via `scripts/browser_path.mjs` (Google Chrome 149, headless,
  swiftshader). Same machine as `perf-baseline-v016.md` (Apple M4 Max, macOS 26.5.1).
- Each script forces a mobile/touch profile (`isMobile`, `hasTouch`). Five drive an IN-GAME
  **landscape** viewport (decision 16a: in-game is landscape-only on web mobile);
  `mobile_input_zoom_check` uses PORTRAIT phone sizes because it tests shell / login / admin
  form-control fonts, not the in-game HUD.

## Command

```sh
GAME_URL=http://localhost:5173 node scripts/<name>.mjs   # exit 0 = pass, non-zero = fail
```

## Recorded PASS / RED set (2026-06-24, untouched v0.16.0)

| Script | Kind | Result | What it does on this run |
|---|---|---|---|
| `mobile_input_zoom_check` | TRUE assertion | **PASS (exit 0)** | "28 passed, 0 failed": every text control font-size >= 16px across 6 phone sizes on the client AND admin.html, plus `(pointer: coarse)`, plus a desktop regression that small fonts are retained |
| `mobile_minimap_safe_area` | TRUE assertion (geometric) | **PASS (exit 0)** | `#minimap-wrap` right edge: BEFORE 661px clipped under a simulated 44px notch, AFTER 623px clears it |
| `mobile_chat_safe_area` | screenshot / simulation | **PASS (exit 0)** | wrote before/after chat-box PNGs under a simulated left notch (no layout assertion) |
| `mobile_community_hud_safe_area` | screenshot (real CDP inset) | **PASS (exit 0)** | "using real CDP safe-area inset"; wrote `#community-hud` before/after PNGs; it is the only one that touches `#rotate-device` (to hide it so the HUD renders) |
| `mobile_button_size` | screenshot harness | **RED (exit 1)** | threw at the warrior-class click (`scripts/mobile_button_size.mjs:31`) |
| `mobile_joystick_size` | screenshot harness | **RED (exit 1)** | identical failure (structurally identical to button_size) |

## The two RED scripts: characterized, NOT fixed here (per the stopping rule)

`mobile_button_size` and `mobile_joystick_size` fail at
`page.click('#offline-select .mini-class[data-class="warrior"]')`. This is **NOT a product /
CSS / layout regression and NOT something P0 introduced**:

- The warrior-chip selector is VALID in the markup (verified in index.html).
- Both scripts boot into the game on a mobile-touch viewport but, unlike `mobile_chat_safe_area`
  / `mobile_minimap_safe_area` / `mobile_community_hud_safe_area`, they do **not dismiss the
  `#mobile-preflight` overlay**. On mobile-touch the preflight appears after `#btn-offline` and
  intercepts the warrior-chip click, so puppeteer's click throws.
- It is a **pre-existing harness gap (missing preflight dismissal)** in two loosely-maintained
  screenshot harnesses. `mobile_input_zoom_check` also lacks preflight handling yet passes,
  because it tests shell / login / admin form controls and never boots the game world.

Recorded as RED on the untouched green tree per decision 16; the fix is P4a / P4b's, not P0's.

## Gaps to hand to P4a / P4b (surfaced, not absorbed)

Decision 16 treats all six as a "blocking RESPONSIVE row", but as shipped today:

1. **Only TWO of the six actually assert and can fail the process**: `mobile_input_zoom_check`
   (font >= 16px) and `mobile_minimap_safe_area` (geometric). The other four are screenshot /
   simulation harnesses that exit 0 regardless of layout (and two of those four cannot even
   boot, see above). P4a / P4b must add real assertions (or wrap them) for the row to be
   genuinely blocking.
2. **No portrait in-game `#rotate-device` assertion exists in any of the six.** Decision 16a's
   promised "portrait-in-game shows the `#rotate-device` overlay, not a broken HUD" check is NOT
   implemented; only `mobile_community_hud_safe_area` even references `#rotate-device`, and only
   to HIDE it. P4b must add the portrait-overlay assertion so there is a real landscape-only
   floor to compare against. (The `#rotate-device` overlay + orientation logic itself lives in
   the HTML entries + `main.ts:474/482`, not in these scripts.)
3. **Port drift**: `mobile_chat_safe_area` defaults to :5174 while the rest default to :5173.

## What later phases do with this

P4a / P4b: wire `mobile_input_zoom_check` + `mobile_minimap_safe_area` (the two real
assertions) as the blocking responsive row immediately; repair `mobile_button_size` /
`mobile_joystick_size` (add preflight dismissal) and add real assertions + the portrait
`#rotate-device` assertion before relying on the full six. The per-frame phases inherit this as
the responsive non-regression floor.
