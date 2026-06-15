# @mention Groups (team mentions) — Spec & Plan

Date: 2026-06-14
Gap: Jira supports @mentioning a group/team to notify everyone in it. Cadence only mentions individuals (`extractMentions` over user names). Genuine Jira-parity gap (fresh analysis).

## Goal
Typing `@<Team Name>` in an item/work-item comment notifies **every member of that team** (one `mention` notification each), reusing the existing notification fan-out. Teams are the groups (`structure.teams`, each has `members`).

## Design (pure core, minimal blast radius)
Hook into the EXISTING mention path (`src/server/notify.ts`), keep the new logic pure and unit-tested like the rest of the engine.

- **Pure helper** `expandGroupMentions(text, groups)` → returns the de-duped list of member names mentioned via a group. Implementation reuses `extractMentions(text, groups.map(g => g.name))` (same word-boundary regex, so `@Checkout Crew` matches as a token and `@Checkout Crews` does not), then maps each matched group name → its `members`.
  - `groups: { name: string; members: string[] }[]` (member = user display name).
- **`planNotifications`** gains an **optional 4th param** `groups: { name: string; members: string[] }[] = []` (backward-compatible: existing 3-arg call sites and tests keep working). Group members fold into the existing `mentioned` set:
  ```
  const mentioned = new Set([
    ...extractMentions(text, users.map(u => u.name)),        // individuals
    ...expandGroupMentions(text, groups),                    // team members
  ].map(n => n.toLowerCase()));
  ```
  Everything downstream is unchanged: `kind:"mention"` wins over `comment`/watcher, the actor is always excluded (even if their own team is mentioned), one row per user.
- **`notifyAfterCommand`** builds `groups` from the read-side: `const struct = await getStructure(); const groups = struct.teams.map(t => ({ name: t.name, members: t.members.map(m => m.name) }));` and passes it to `planNotifications`. Best-effort fan-out already tolerates failure.
- **Client autocomplete** (`src/components/App.tsx`): include team names in the `mentionNames` list fed to `MentionTextarea` (`names` prop) so `@<team>` autocompletes. `matchNames` already handles multi-word queries. No change to `MentionTextarea` or `src/lib/mentions.ts`.

### Rules / edge cases
- Member already individually `@`-mentioned → de-duped (single row, mention kind).
- Unknown / unmatched group name → no-op (empty expansion).
- Group member who is the actor → still excluded.
- Group member who is also a watcher → one row, `kind:"mention"` (mention wins, existing behavior).
- A name that is both a team name and a user name → both expansions run; harmless (union + dedup).

### Out of scope (v1)
- Distinguishing group vs user in the autocomplete dropdown UI (cosmetic).
- Org-level or ad-hoc groups (only teams).
- A `mention` notification message that names the team rather than "you" (keep existing per-user message).

## Implementation steps (TDD — RED first)

1. **`src/server/notify.ts`** — add and export pure `expandGroupMentions(text, groups)`.
   - Tests first in `src/server/notify.test.ts` (`describe("expandGroupMentions")`): matches a team token and returns its members; word-boundary (no match for `@TeamX` when team is `Team`); unknown group → []; multiple groups union + dedup overlapping members; empty text/empty groups → [].
2. **`planNotifications`** — add optional `groups` param; fold group members into `mentioned`.
   - Tests (`describe` additions): `@Team` notifies all members `kind:"mention"`, actor excluded even when in the mentioned team; individual + group mention of same user → one row; group member also watching → one `mention` row; 3-arg call (no groups) still behaves exactly as before (regression).
3. **`notifyAfterCommand`** — fetch structure, build `groups`, pass through. (Impure; covered by the existing integration suite + manual verify, not a new unit test.)
4. **`src/components/App.tsx`** — add team names to `mentionNames` (from `structure.teams`).

## Verification gates
- `node_modules/.bin/tsc --noEmit` exit 0.
- `node_modules/.bin/vitest run src/server/notify.test.ts src/lib/mentions.test.ts` green; then full suite no regressions.
- Fresh verification subagent: independent review + gates; ideally drive the live API (post a comment with `@<team>`, confirm member notification rows) per the stale-server checklist.
