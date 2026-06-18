# PRD — 10-Man Raid Groups (and normal-dungeon gating)

> Part of the v0.10.0 release (tracker #634, Priority 2 — raid support). Kickoff
> spec — implementation lands in follow-up commits on this branch.

## 1. Summary

Introduce **raid groups**: a group mode whose size cap is **10** (vs the standard
5-player party). A group becomes a raid when it converts to raid mode or grows past 5.
**Raid groups cannot enter normal (5-man) dungeons** — that content stays a party-only
experience; raid groups are for raid instances only.

## 2. Motivation

- Required to run the first 10-man raid (#634 Priority 2): the party system currently
  caps at 5, so there is no vessel for a raid roster.
- Gating raid groups out of 5-man dungeons preserves the intended 5-man dungeon tuning
  and prevents over-stacking normal content.

## 3. Behavior

- **Raid conversion:** a party leader can convert the group to a raid; capacity rises
  from 5 to **10**. (v1: explicit "convert to raid"; auto-convert on 6th invite is a
  later option.)
- **Membership:** invites up to 10; loot/roll eligibility (incl. need/greed, #636) and
  XP/credit rules extend to the full raid roster.
- **Normal-dungeon gating:** attempting to enter a 5-man dungeon while in a raid group is
  **blocked server-side** with a clear, localized reason ("Raid groups cannot enter this
  dungeon"). Raid instances accept raid groups; solo/party rules for open world unchanged.
- **Disband/shrink:** dropping back to <=5 may revert to a normal party (v1 keeps raid
  mode until explicitly disbanded — decide during implementation, document the choice).
- Server-authoritative group state; client renders roster/raid UI only.

## 4. Hook points (re-find exact file:line before editing)

- Party/group model + size cap in `src/sim/` (the constant capping a party at 5) and the
  group state surfaced via `IWorld` (`src/world_api.ts`) — add raid mode + size 10 to both
  `Sim` and `ClientWorld`.
- Server social/group command handling: convert-to-raid, invite-up-to-10, raid disband.
- Dungeon entry resolution (`src/sim/dungeon_layout.ts` consumers / instance entry in
  `server/`): block raid groups from 5-man dungeon instances; allow raid instances.
- `src/ui/`: raid roster frames (party HUD already exists; extend to up to 10) and the
  blocked-entry message. All strings are `t()` keys.
- i18n: raid labels, convert/disband prompts, the blocked-entry reason (`en` first +
  client matcher for sim/server-emitted text).

## 5. Acceptance criteria

- [ ] A group can convert to a raid and hold up to 10 members.
- [ ] Raid groups are blocked from entering normal 5-man dungeons, with a localized reason.
- [ ] Raid groups can enter raid instances; party/solo open-world behavior is unchanged.
- [ ] Loot eligibility (incl. need/greed #636) and XP/credit extend to all raid members.
- [ ] Group/raid state is server-authoritative and identical in `Sim` and `ClientWorld`.
- [ ] Raid HUD renders up to 10 members; all strings localized; S3 + release gate pass.

## 6. Test plan

- Sim/unit: cap is 10 in raid mode, 5 in party mode; raid-group dungeon entry blocked;
  raid-instance entry allowed; loot/XP eligibility across 10 members.
- Parity: raid group state present and identical in `Sim` and `ClientWorld` (wire round-trip).
- i18n: blocked-entry + raid labels localized; `tests/localization_fixes.test.ts` + release gate green.
- Manual: form a 10-player raid, attempt a 5-man dungeon (blocked), enter the raid instance.
