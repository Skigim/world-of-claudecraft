# PRD — First Cosmetic Skin: "Skyfall" (event-gated claim)

> Part of the v0.10.0 release (tracker #634, Priority 1). Kickoff spec — the
> implementation lands in follow-up commits on this branch.

## 1. Summary

Claudemoon's first-ever **cosmetic skin**, granted by completing a one-time event
quest. A crash site appears in the hills beyond Fenbridge; the player finds **Brother
Aldric**, investigates the crash, and completes the quest to unlock the skin. The
claim window is **open for 24 hours** from event start — claim it in-window and it is
permanent on the account; miss it and the questline closes.

Cosmetic-only: the skin changes appearance, never stats. It must persist per account
and render identically across offline, server, and headless hosts (presentation is
client-side, but the *unlock* is authoritative server state).

## 2. Motivation

- First live event payoff and the first purely-cosmetic reward — sets the pattern for
  future limited-time cosmetics without touching balance.
- Drives event attendance (the "Play with the Team" session).

## 3. Behavior

- **Discovery:** a crash-site object/marker is placed in the hills beyond Fenbridge.
  Visible only while the event window is open.
- **Quest:** a new Brother Aldric quest chain ("investigate the crash") that turns in
  at the crash site. Completion grants the cosmetic unlock (not an inventory item that
  can be traded/sold — an account-bound cosmetic flag).
- **Time gate:** the quest is acceptable/completable only within the 24h window. The
  window is configured server-side (start timestamp + duration), not hard-coded to a
  date in sim logic (determinism: no `Date.now()` in `src/sim/`; the server supplies
  the gate state to the sim/client).
- **Reward:** an unlocked skin selectable from the existing character appearance path
  (`skin` is already persisted in character state). Once unlocked, it is permanent.

## 4. Hook points (re-find exact file:line before editing)

- `src/sim/content/items.ts` / quest content (`src/sim/content/zone*.ts`) — the Brother
  Aldric crash quest + crash-site object.
- Character appearance: the `skin` field already in persisted character `state` (see
  `server/db.ts` JSONB) and the renderer's skin swap (`CharacterVisual.setSkin`).
- New account-bound **cosmetic unlock** state: additive JSONB on the account/character
  (back-compat; defaults to "not unlocked"). Server-authoritative.
- Event-window gate: server config + a flag surfaced to the client (mirror the
  restart-countdown secret/config pattern; do not bake a date into `src/sim/`).
- i18n: quest text, the skin/cosmetic name, and claim UI strings are `t()` keys in `en`
  first, re-localized via the client matcher for any sim/server-emitted text.

## 5. Acceptance criteria

- [ ] Completing the quest within the window unlocks the skin; it stays unlocked forever.
- [ ] The quest cannot be accepted or completed outside the window.
- [ ] The cosmetic changes only appearance — no stat/affix effect.
- [ ] Unlock is account/character-persistent and survives relog and redeploy.
- [ ] All player-facing strings are localized (`en` + client matcher); S3 guard passes.
- [ ] Deterministic: no `Date.now()`/wall-clock in `src/sim/`; window state flows from the server.

## 6. Test plan

- Sim/unit: quest accept/turn-in inside vs outside the window; unlock persists in saved state.
- Server: unlock write is parameterized and inside the DB module; relog reflects the unlock.
- i18n: `tests/localization_fixes.test.ts` (S3) green; release-tier gate green.
- Manual: claim flow at the event; skin renders; second account without claim does not have it.
