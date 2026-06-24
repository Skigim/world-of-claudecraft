# P0 visual (screenshot) baseline (v0.16.0)

The screenshot floor P4a / P4b and every cascade-risking CSS phase (P1 to P4b) diff against.
`css_corpus` proves no CSS rule TEXT was dropped, but it is layout-blind: a `dvh` to `100vh`
swap, a dropped `safe-area-inset`, or a lost `@media` breakpoint can all be CSS-text-complete
yet visually broken. This baseline plus the mobile-layout baseline close that gap.

P0 only RUNS and RECORDS the shipped `scripts/*_shot.mjs` suite; it authors no new screenshot
tool and edits none of the existing shots.

## Shape of the suite (important for how to use this baseline)

- The suite is **~89 standalone `*_shot.mjs` scripts. There is no canonical driver / runner.**
  Each is an independent top-level script that launches its own headless browser via
  `scripts/browser_path.mjs`, boots the offline client, drives one scene, and writes PNG(s).
- **There is NO golden-image / diff harness in the repo today.** Shots overwrite their PNGs
  each run; comparison has always been human / PR-asset visual. So the "screenshot-diff vs the
  P0 baseline" the validation matrix calls for is a P0-INTRODUCED obligation: the durable
  baseline is the shot SCRIPT itself (shipped in-repo, so the scene definition is version
  controlled) plus this captured-run manifest. A later CSS phase RE-RUNS the same relevant
  shot on the same setup and compares (visually, or byte/structurally) against its P0 image.
- The PNGs are large (2 to 9 MB) and land in gitignored `tmp/` (a few in `screenshots/`), so
  they are NOT committed. This doc records each scene's exact command, output path, byte size,
  and sha256 as the point-in-time reference.

## Prerequisite (exact)

- `npm run dev` (Vite) on **http://localhost:5173** (offline `Sim`; no `npm run server`, no
  Postgres for the scenes below). Override per-scene with `GAME_URL=http://localhost:5173`.
- A Chromium-family browser via `scripts/browser_path.mjs` (here Google Chrome 149, headless,
  ANGLE swiftshader). Same machine spec as `perf-baseline-v016.md` (Apple M4 Max, macOS 26.5.1).

## Command pattern

```sh
GAME_URL=http://localhost:5173 node scripts/<scene>_shot.mjs   # writes PNG(s) to tmp/
```

## Captured reference set (2026-06-24, rendered clean on this machine)

Curated to cover the CSS surfaces P1 to P4b touch: the theme picker (its own CSS section),
classic windows, nameplates / target chrome, and the touch-controls cluster. sha256 is the
first 16 hex chars of the full digest.

| Scene script | Output PNG | bytes | sha256 (first16) |
|---|---|---|---|
| `theme_shot.mjs` | `tmp/theme-classic.png` | 8782284 | 981bd20e67aa3fa1 |
| `theme_shot.mjs` | `tmp/theme-custom.png` | 8798898 | 90247f0d8d73e7de |
| `theme_shot.mjs` | `tmp/theme-highContrast.png` | 8673940 | f157c05608ed0603 |
| `theme_shot.mjs` | `tmp/theme-midnight.png` | 8805357 | 4f1be4ed769be7e3 |
| `theme_shot.mjs` | `tmp/theme-parchment.png` | 8852994 | fd568effd6d9d07a |
| `theme_shot.mjs` | `tmp/theme-options-panel.png` | 7854418 | 6e132a34b9450a70 |
| `tab_target_shot.mjs` | `tmp/tab_target_01_no_target.png` | 2260480 | f207afe5426c45eb |
| `tab_target_shot.mjs` | `tmp/tab_target_02_after_tab.png` | 2266059 | 2a56153c62a8d299 |
| `loot_roll_shot.mjs` | `tmp/loot_roll_prompt.png` | 8440985 | 7d504ac9837e9e3b |
| `loot_roll_shot.mjs` | `tmp/loot_roll_prompt_crop.png` | 692351 | f55c113bc58693f9 |
| `mmo_controls_shot.mjs` | `screenshots/` (rendered, exit 0) | n/a | n/a |

## Caveats recorded (not absorbed)

- **The sha256 values are a same-machine / same-Chrome / point-in-time reference, NOT a
  byte-exact diff floor.** Software WebGL output is not guaranteed byte-identical across runs
  (timing / rasterization jitter), so a later phase should compare structurally / visually,
  or re-baseline on its own machine first, rather than treating a hash mismatch alone as a
  regression. The hashes prove the images exist and are the captured reference; the durable
  contract is the scene SCRIPT.
- **Several scene scripts are flaky under headless swiftshader (~1 to 2 fps): they hit a
  scene-specific `waitForSelector` before the slow software render settles and throw (exit 1).
  Observed flaky this run: `clock_shot`, `perf_overlay_shot`, `tutorial_shot`,
  `keybinds_layout_shot`, `selection_ring_shot`, `resting_indicator_shot`,
  `interface_settings_shot`.** This is a software-render / timing artifact, not a product
  regression; these same scenes render on a real GPU or with longer settle. Recorded here per
  the stopping rule (a scene that cannot render is recorded, not fabricated) rather than
  silently dropped. A later phase that needs one of these as a diff target should run it with a
  larger settle / real GPU.
- **Backend-requiring shots are excluded from this baseline** (need `npm run server` + a
  `DATABASE_URL`): `account_portal_shots`, `account_security_shots`, `name_reclaim_shot`,
  `takeover_shot`, `realm_pop_tooltip_shot`, `raid_social_shot`, `feature_request_shots_641`.
  Out of scope for the game-HUD CSS this packet extracts.

## What later phases do with this

P4a / P4b and every cascade-risking CSS phase: after moving a CSS section, re-run the relevant
shot(s) above on the same setup and confirm the scene still renders the same layout (no lost
breakpoint / safe-area / glass). Pair with `mobile-baseline-v016.md` for the responsive floor
that screenshots alone do not assert.
