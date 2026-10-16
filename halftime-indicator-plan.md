# Halftime Indicator — Plan

## Overview

Add a **Half** toggle button to the live gamesheet that marks the end of the first half after any scored point. The marker is stored as a single index on the sheet's data blob and drives three visual surfaces: the live point selector strip, the score sheet table columns, and the score summary panel.

Toggling the button a second time on the same point clears the marker (undo). The button is accessible from any point in the selector strip, not just the currently-active live point, so coaches can correct a missed press retroactively.

---

## Sub-Tasks

---

### Sub-Task 1 — Extend the data model

**Intent**  
Add the `halfTimeAfterPoint` field to `GameSheetData` so the half marker can be persisted alongside the rest of the sheet blob. No migration is required — the field is optional and absent on existing sheets.

**Expected Outcomes**  
- `GameSheetData` has `halfTimeAfterPoint?: number | null`
- TypeScript compilation succeeds with no new errors

**Todo List**  
- [ ] In `types/types.ts`, add `halfTimeAfterPoint?: number | null` to the `GameSheetData` interface (after the existing timeout fields, before `lineDividers`)

**Relevant Context**  
- `types/types.ts` lines 70–92 — `GameSheetData` interface
- Field stores the **0-based index** of the last point of the first half; `null` or absent means no half marked

**Status** `[ ] pending`

---

### Sub-Task 2 — Add the toggle function

**Intent**  
Implement `toggleHalfTime(pointIndex: number)` inside `GameSheet.tsx`. If `halfTimeAfterPoint` already equals `pointIndex`, clear it to `null` (undo). Otherwise set it to `pointIndex`. Always calls `saveData` so the change persists and syncs.

**Expected Outcomes**  
- Clicking Half on an unmarked point marks it
- Clicking Half on the already-marked point unmarks it
- `saveData` is called in both cases so the change persists

**Todo List**  
- [ ] Add `toggleHalfTime` function near the other toggle helpers (`toggleCleanHold`, `toggleCleanBreak`) around line 657 of `components/GameSheet.tsx`
- [ ] Function body: read `displayData.halfTimeAfterPoint`, compare to `pointIndex`, set or clear, call `saveData`

**Relevant Context**  
- `components/GameSheet.tsx` lines 657–669 — `toggleCleanHold` / `toggleCleanBreak` for pattern reference
- `saveData` at line 321

**Status** `[ ] pending`

---

### Sub-Task 3 — Add the Half button to the live panel sub-header

**Intent**  
Place a **½ Half** toggle button in the point sub-header row (the same row that contains Hold and Break checkboxes) so coaches can mark or clear halftime for the currently-selected point during live play. The button is visually highlighted when the selected point is marked as end-of-half.

**Expected Outcomes**  
- A "½ Half" button appears to the right of the Break checkbox in the live mode sub-header
- When the selected point is marked as end-of-half, the button renders in an active/highlighted style (purple accent, consistent with the app's existing accent palette)
- When not marked, the button renders in a muted/outline style matching the Hold/Break checkboxes nearby
- Button is disabled when `isReadOnly` is true
- Toggling works correctly (mark → unmark → mark)

**Todo List**  
- [ ] In `components/GameSheet.tsx`, inside the live mode sub-header `<div className="flex items-center gap-3">` at ~line 1559, add the Half button after the Break label
- [ ] Button calls `toggleHalfTime(selectedLivePoint)`
- [ ] Active style: `bg-purple-600 text-white ring-2 ring-purple-400`
- [ ] Inactive style: `bg-purple-500/20 text-purple-800 dark:text-purple-300 border border-purple-500/40`
- [ ] Button label: `½ Half`; add a title tooltip: `"Mark/unmark halftime after this point"`

**Relevant Context**  
- `components/GameSheet.tsx` lines 1559–1598 — the Hold/Break controls row  
- Pattern: same button shape as `+1 {teamName}` / `+1 Opponent` buttons at lines 1457–1480

**Status** `[ ] pending`

---

### Sub-Task 4 — Visual indicator in the point selector strip

**Intent**  
Show a small `½` badge on the point button in the selector strip that is marked as end-of-half, so the coach can see at a glance where the half boundary sits without opening the sub-header.

**Expected Outcomes**  
- The half-marked point button in the strip shows `½` after the scorer emoji (or point number if no scorer yet)
- No other point buttons are changed

**Todo List**  
- [ ] In the point selector strip map (~line 1496–1515 of `components/GameSheet.tsx`), after the scorer emoji lines, add: `{displayData.halfTimeAfterPoint === idx && " ½"}`

**Relevant Context**  
- `components/GameSheet.tsx` lines 1496–1515 — point selector strip render

**Status** `[ ] pending`

---

### Sub-Task 5 — Visual divider in the score sheet table

**Intent**  
In the score sheet table (the main grid of player rows + score rows), inject a thin vertical "HALF" column between point N and N+1 when `halfTimeAfterPoint` is set. This mirrors the approach used for player-row `lineDividers` and makes the half boundary visible on the printed/on-screen sheet.

**Expected Outcomes**  
- A narrow column with "HALF" label (rotated text) appears between the last first-half point column and the first second-half point column
- The column spans all rows (header + player rows + Hold/Break/Score rows)
- Absent when no halftime is marked

**Todo List**  
- [ ] Locate the point column header row in the `<thead>` and inject a `<th>` narrow column (e.g. `w-4`) with rotated "HALF" label after `halfTimeAfterPoint` index
- [ ] In every `displayData.points.map(...)` body across the player rows, Hold row, Break row, Team Score row, and Opponent Score row — after rendering point index `halfTimeAfterPoint`, inject a matching `<td>` spacer cell with a left border accent (`border-l-2 border-purple-400`)
- [ ] Use a helper constant `halfIdx = displayData.halfTimeAfterPoint ?? -1` to keep the conditional clean

**Relevant Context**  
- `components/GameSheet.tsx` lines 2600–2710 — Hold row, Break row, Score rows (all use `displayData.points.map`)
- The `<thead>` point number header row is just above line 2600 — find exact line during implementation
- Print CSS: the injected column must be narrow enough not to break the print layout; use `w-4 min-w-[1rem]`

**Status** `[ ] pending`

---

### Sub-Task 6 — Half-score breakdown in the score summary panel

**Intent**  
When `halfTimeAfterPoint` is set, show an H1 and H2 score breakdown in the "Score & Point Stats" panel at the bottom of the sheet. This gives coaches and stats-takers a quick half-by-half read.

**Expected Outcomes**  
- Below the existing `{teamName} Score` / `{opponentName} Score` total boxes, a new row shows `H1: X – Y  |  H2: X – Y` when a half is marked
- Row is hidden when no half is marked
- Values are derived purely from `ourRunningScores` / `theirRunningScores` — no new DB fields

**Todo List**  
- [ ] Compute `h1OurScore`, `h1TheirScore`, `h2OurScore`, `h2TheirScore` from the running score arrays using `halfTimeAfterPoint` as a split index (derive these near the existing `totalOurScore` / `totalTheirScore` lines ~894)
- [ ] In the "Score & Point Stats" card (~line 2828), add a conditional row below the score grid: `{displayData.halfTimeAfterPoint != null && ( <div>H1: {h1OurScore} – {h1TheirScore} &nbsp;|&nbsp; H2: {h2OurScore} – {h2TheirScore}</div> )}`
- [ ] Style consistent with existing muted stat labels; use purple accent to tie back to the half theme

**Relevant Context**  
- `components/GameSheet.tsx` lines 2827–2866 — "Score & Point Stats" card screen view
- `ourRunningScores[halfTimeAfterPoint].total` gives H1 our score; `totalOurScore - h1OurScore` gives H2

**Status** `[ ] pending`

---

## Non-Goals

- No automatic half detection by score threshold or time — the coach marks it manually
- No second-half possession tracking change (the app already does not track end-change)
- No changes to the print layout beyond the narrow divider column
- No changes to the Supabase schema (the field is already inside the `sheet_data` JSONB blob)
