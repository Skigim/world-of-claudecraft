<!-- World of Claudecraft — project-root CLAUDE.md.
     Keep this under ~150 lines and strictly repo-wide. Area-specific guidance
     lives in each subdirectory's own CLAUDE.md (src/sim/, src/render/, server/,
     ...), which load on demand when you open files there — do NOT duplicate
     them here. HTML comments like this are stripped before load (zero tokens). -->

# World of Claudecraft

A WoW-Classic-style micro-MMO **and** a headless reinforcement-learning
environment, both driven by one deterministic TypeScript simulation core.
Stack: TypeScript (ESM, `strict`) · Three.js renderer · `ws` WebSockets ·
Postgres (`pg`) · Vite + esbuild · Vitest. No UI framework; tiny dependency set.

## Repo map
| Path | What it is |
|---|---|
| `src/sim/` | **Deterministic game core — the source of truth.** No DOM/Three deps; runs in browser, server, and headless. |
| `src/sim/content/` | Data-as-code: the 9 classes, abilities, zones, dungeons, items, talents. |
| `src/render/` | Three.js renderer (procedural geometry/textures/VFX). Reads the world; never mutates it. |
| `src/game/` | Local input, camera, keybinds, mobile controls, procedural WebAudio. |
| `src/ui/` | Classic HUD (frames, windows, tooltips, map, FCT), procedural icons, i18n. |
| `src/net/` | Online client: REST auth + WebSocket world mirror (`ClientWorld`). |
| `src/admin/` | Admin dashboard SPA (separate `admin.html` entry). |
| `src/world_api.ts` | `IWorld` — the seam render/ui depend on (see Architecture). |
| `src/main.ts` | Client entry; fixes the world seed. |
| `server/` | Authoritative game server: HTTP+WS, world loop, Postgres, auth, social, moderation. |
| `headless/` + `python/` | RL env server (`env_server.ts`) + Python Gym bindings. |
| `tests/` | Vitest suite. |
| `scripts/` | Asset build + browser E2E / screenshot / integration scripts (`.mjs`). |
| `public/` · `docs/` | Static assets (GLB models / textures / HDRIs) · design + PRD docs. |

Most directories above have their own `CLAUDE.md` with local conventions — read it when you work there.

## Commands
- `npm run dev` — Vite client on :5173 (proxies `/api`, `/admin/api`, `/ws` → :8787).
- `npm run server` — esbuild-bundle + run the authoritative server on :8787.
- `npm test` — Vitest. **Prefer a single file while iterating:** `npx vitest run tests/sim.test.ts`.
- `npm run build` — generate media manifest → `vite build` → emit manifest. Two entries (game + admin).
- `npm run env` / `npm run bench` — build + run the headless RL env server.
- `npm run db:up` / `npm run db:down` — Postgres 16 in Docker (dev DB on :5433).
- `npm run realms` — run multiple realm processes locally.

See `README.md` for the full host/develop/play guide and the classic-fidelity checklist; `DEPLOY.md` for production.

## Architecture (the load-bearing ideas)
- **One sim, three hosts.** The exact same `src/sim/` code runs the offline
  browser world, the online server, and the RL env. Behavior must be identical
  everywhere — that is the whole point.
- **`IWorld` is the only seam.** `src/world_api.ts` defines `IWorld`; the offline
  `Sim` satisfies it structurally and the online `ClientWorld` implements it by
  mirroring server snapshots. **`src/render/` and `src/ui/` talk only to `IWorld`**,
  never to `Sim`/`ClientWorld` concretely. New feature → extend `IWorld` first,
  then implement it in both worlds.
- **The server is authoritative.** Clients stream movement intent + commands at
  20 Hz; the server runs the one shared `Sim` and returns interest-scoped
  (~120 yd) snapshots + per-player events. All combat, loot, quest credit, and
  economy resolve server-side. The client is a renderer; it never decides outcomes.

## Invariants — YOU MUST keep these
- **`src/sim/` has zero DOM/browser/Three.js imports** and never imports from
  `render/`, `ui/`, `game/`, or `net/`. It must run unchanged in Node and the
  browser. (Enforced by convention only — don't break it.)
- **Determinism.** The sim is a fixed **20 Hz** tick (`DT = 1/20`). All randomness
  goes through `Rng` (`src/sim/rng.ts`) — **never `Math.random`**, `Date.now`, or
  `performance.now` in sim logic. Same seed ⇒ same world.
- **Gameplay math follows real vanilla-WoW formulas** (rage, hit tables, armor DR,
  XP curves — see `README.md` and `docs/design/`). Don't invent balance numbers.
- **Don't hand-edit generated files** — e.g. `src/render/assets/manifest.generated.ts`
  (regenerate via the build).
- **i18n: every player-visible string is a `t()` key, in every locale.** Each
  locale in `src/ui/i18n.ts` is `: typeof en`, so `tsc` fails on a missing/renamed
  key — but it **cannot** see a hard-coded literal that never became a key, nor a
  new English string emitted by `src/sim/`/`server/` and never registered in the
  client matcher. Both compile green and ship English to a translated player.
  Closing those two gaps is on you, not the compiler.
  - **Add the key to `en` first, then a real translation to every locale** in
    `translations` (`Object.keys(translations)`/`supportedLanguages` is the
    authoritative set — never author against a printed list). No English copy,
    placeholder, or `// TODO`; no "temporary English."
  - **The final rendered text — however assembled — comes from `t()`.** Not concat,
    template parts, `?? 'English'` fallbacks, default params, `const LABELS={…}`
    maps, or literals passed to `setAttribute('aria-label'|'title'|'placeholder'|'alt')`
    / `document.title` / native `confirm`/`prompt`/`alert`. Numbers · money · dates ·
    units · percents go through `formatNumber`/`formatDateTime`/`formatMoney`/`Intl`.
  - **Classify by render sink, not statement type.** Anything a user can read —
    labels, tooltips, placeholders, aria/alt, toasts, dialogs, validation +
    "connection lost" errors, static HTML, meta/`document.title`, server-sent player
    text, **and the whole admin dashboard** (operators are users) — is in scope.
    Only dev-channel text (`console.*`, assertions, a `throw` no catch surfaces) stays
    English; if one string feeds both a log and the UI, **split it**.
  - **`src/sim/` and `server/` stay language-agnostic** (no `t()`, no DOM) but their
    player text is still in scope: emit a stable key + values, **or** English that is
    re-localized via the client matcher (`src/ui/sim_i18n.ts` + `server_i18n.ts`
    mirror) **in the same change** — the S3 guard (`tests/localization_fixes.test.ts`)
    enforces it. Translation resolves only at the client boundary.
  - **Emojis/symbols** need no entry and may appear inline or stand alone, but never
    replace a required translation (the aria name behind an emoji is still a `t()`
    key). Distinct from the separate "no raw emojis as in-game icons" aesthetic rule.
- **Never set `ALLOW_DEV_COMMANDS=1` in production** (it enables level/teleport/item cheats).
- **Never commit `.env` or secrets.**

## Conventions
- **ESM + TypeScript `strict`** everywhere. 2-space indent; match the surrounding file.
- **Large single-file modules are normal here** (`sim.ts` ~4.7k lines, `hud.ts`
  ~3.5k). Follow the existing in-file structure; **don't split a module just to hit
  a line count.** (This overrides any generic "files < N lines" rule from a
  higher-level CLAUDE.md.)
- **Keep the dependency set tiny.** Don't add packages without a clear need.
- **Commits:** Conventional Commits with a scope — `feat(talents): …`, `fix(net): …`,
  `test(sim): …`. Branches: `feature/<slug>`, `fix/<slug>`.

## Testing & verification
- Logic/unit: Vitest (`tests/`). Add or update tests when you change sim or server behavior.
- E2E/visual: `scripts/*.mjs` drive real browsers via `puppeteer-core` and need
  `npm run dev` (often `npm run server` too) running. Bot raids / E2E that teleport
  or level need `ALLOW_DEV_COMMANDS=1` (dev only).

## Pointers
`README.md` (host/develop/play + fidelity checklist) · `DEPLOY.md` (production) ·
`CREDITS.md` (asset licenses) · `docs/design/` (design docs) · `docs/prd/` (feature specs).
