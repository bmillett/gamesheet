export const dynamic = "force-dynamic"

export default function HelpPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-bold text-foreground">Help & User Guide</h1>
        <p className="text-xs text-muted-foreground mt-0.5">How to use the 7s Gamesheet app</p>
      </div>

      {/* Formats */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>🔀</span> 7v7 and 4v4 Formats
        </h2>
        <p className="text-sm text-muted-foreground">
          Each team is set to either <strong className="text-foreground">7v7</strong> or <strong className="text-foreground">4v4</strong>. The format is shown next to the team name in the team switcher. It controls the grid size, line splits, points range, and gender ratio rules throughout the app.
        </p>
        <div className="rounded-lg border border-border overflow-hidden text-sm">
          <table className="w-full">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="p-2.5 text-left font-semibold"></th>
                <th className="p-2.5 text-left font-semibold">7v7</th>
                <th className="p-2.5 text-left font-semibold">4v4</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-muted-foreground">
              <tr>
                <td className="p-2.5 font-semibold text-foreground">Players on field</td>
                <td className="p-2.5">7</td>
                <td className="p-2.5">4</td>
              </tr>
              <tr>
                <td className="p-2.5 font-semibold text-foreground">Roster / grid slots</td>
                <td className="p-2.5">24</td>
                <td className="p-2.5">12</td>
              </tr>
              <tr>
                <td className="p-2.5 font-semibold text-foreground">Default line split</td>
                <td className="p-2.5">8 / 8 / 8</td>
                <td className="p-2.5">4 / 4 / 4</td>
              </tr>
              <tr>
                <td className="p-2.5 font-semibold text-foreground">Split presets</td>
                <td className="p-2.5">8/8/8, 10/7/7, 12/12, No Split</td>
                <td className="p-2.5">4/4/4, 6/6, No Split</td>
              </tr>
              <tr>
                <td className="p-2.5 font-semibold text-foreground">Points slider</td>
                <td className="p-2.5">29–40 (default 30)</td>
                <td className="p-2.5">30–60 (default 40)</td>
              </tr>
              <tr>
                <td className="p-2.5 font-semibold text-foreground">Gender ratio</td>
                <td className="p-2.5">4F/3M ↔ 3F/4M, ABBAABBAA pattern</td>
                <td className="p-2.5">Always 2F/2M</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Changing format:</strong> go to <strong className="text-foreground">Coaches &amp; Staff → Team Settings</strong>, choose 7v7 or 4v4, and click Save. Existing game sheets keep their original layout; only new sheets use the new format.
        </p>
      </section>

      {/* Roster */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>👥</span> Roster Page
        </h2>
        <p className="text-sm text-muted-foreground">
          Set up your roster before your first game: <strong className="text-foreground">24 players for 7v7</strong> or <strong className="text-foreground">12 players for 4v4</strong>. Players marked <strong className="text-foreground">Active</strong> will appear in the gamesheet bench pool.
        </p>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-28 shrink-0">Add player</span>
            <span className="text-muted-foreground">Click <strong className="text-foreground">+ Add Player</strong> at the bottom of the table. Click the name field to type it in, then press Enter or click Save.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-28 shrink-0">Jersey #</span>
            <span className="text-muted-foreground">Type a 1 or 2 digit number. Digits only, max 2 characters.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-28 shrink-0">Gender</span>
            <span className="text-muted-foreground"><strong className="text-pink-600">FMP</strong> = Female Matching Player, <strong className="text-blue-600">MMP</strong> = Male Matching Player. Shown as a coloured dot on the bench and in live mode.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-28 shrink-0">Position</span>
            <span className="text-muted-foreground">Handler (H), Cutter (C), or Hybrid (HY). Shown as an abbreviated badge on bench cards.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-28 shrink-0">Active</span>
            <span className="text-muted-foreground">Toggle Yes/No. Only active players appear in the gamesheet bench. Deactivate players who are unavailable for a tournament.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-28 shrink-0">Order</span>
            <span className="text-muted-foreground">Use the ↑ ↓ arrows to reorder players. This determines slot order in the gamesheet grid.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-28 shrink-0">Bulk import</span>
            <span className="text-muted-foreground">Click <strong className="text-foreground">Bulk import via CSV paste</strong> and enter one player per line: <code className="bg-muted px-1 rounded text-xs">7, Jane Doe, Handler, FMP</code>. Gender (FMP or MMP) is optional. For 4v4, a balanced roster is 6 FMP and 6 MMP (12 players).</span>
          </div>
        </div>
      </section>

      {/* Sheets */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>📋</span> Sheets Page
        </h2>
        <p className="text-sm text-muted-foreground">
          Each game gets its own sheet. Sheets store the lineup (24 slots for 7v7, 12 slots for 4v4), point-by-point scores, and player stats.
        </p>

        <h3 className="text-sm font-semibold text-foreground pt-1">Managing sheets</h3>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">New sheet</span>
            <span className="text-muted-foreground">Click <strong className="text-foreground">+ New Blank Sheet</strong>. Fill in the Tournament, Opponent, and Field fields at the top.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Use as template</span>
            <span className="text-muted-foreground">Duplicates the current roster layout, line dividers, and line presets into a new sheet with scores reset — useful for back-to-back games.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Points slider</span>
            <span className="text-muted-foreground">Drag the <strong className="text-foreground">Points</strong> slider to set how many point columns are shown. 7v7: 29–40, default 30. 4v4: 30–60, default 40. The setting is saved per sheet.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Archive sheet</span>
            <span className="text-muted-foreground">Locks the sheet as read-only for historical reference. Archived sheets move to the Archived tab. You can unlock and edit them again at any time.</span>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-foreground pt-1">Setting up the lineup</h3>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Bench</span>
            <span className="text-muted-foreground">Click <strong className="text-foreground">👥 Bench</strong> to show the player pool. Each card shows jersey number, a gender dot (pink=FMP, blue=MMP), name, and position abbreviation.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Assign players</span>
            <span className="text-muted-foreground">Drag a player from the bench to any row in the grid, or click a player card then click a target row. Drag between rows to swap.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Line splits</span>
            <span className="text-muted-foreground">Click <strong className="text-foreground">✂ Line Splits</strong> to configure line dividers. <strong className="text-foreground">7v7:</strong> default 8/8/8 (rows 1–8, 9–16, 17–24); other presets 10/7/7, 2 Lines 12/12, or No Split. <strong className="text-foreground">4v4:</strong> default 4/4/4 (rows 1–4, 5–8, 9–12); other presets 2 Lines 6/6, or No Split.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Mark out/injured</span>
            <span className="text-muted-foreground">Click the ⚠️ button on a bench or player card to mark a player as out. They are crossed out and excluded from point tracking.</span>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-foreground pt-1">Scoring points (grid view)</h3>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Record players</span>
            <span className="text-muted-foreground">Click a checkbox in the grid to mark that player as on for that point. The Pts column tracks total points played per player.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Score row</span>
            <span className="text-muted-foreground">The coloured score rows at the bottom of the grid track running totals. Click a cell to toggle a score for that point.</span>
          </div>
        </div>
      </section>

      {/* Live mode */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>🟢</span> Live Game Mode (Sideline)
        </h2>
        <p className="text-sm text-muted-foreground">
          Tap <strong className="text-foreground">⚡ Live Game Mode</strong> to switch to a large-format sideline view optimised for phones and tablets.
        </p>

        <h3 className="text-sm font-semibold text-foreground pt-1">Scoring &amp; possession</h3>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Score a point</span>
            <span className="text-muted-foreground">Tap <strong className="text-emerald-600">+1 Us</strong> or <strong className="text-rose-600">+1 Opponent</strong>. The running score updates instantly. Tap again to undo.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Starting possession</span>
            <span className="text-muted-foreground">Set <strong className="text-foreground">Start On Offense</strong> or <strong className="text-foreground">Start On Defense</strong> before the game starts. Hold/Break outcomes are derived automatically from this setting.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Starting end</span>
            <span className="text-muted-foreground">Tap the arrow button to record which end of the field the team started at (← or →). Tap again to cycle through or clear. Teams switch ends at half.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Hold / Break</span>
            <span className="text-muted-foreground">Shown automatically after scoring. Use the Hold/Break checkboxes to manually override if the auto-detection is wrong.</span>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-foreground pt-1">Setting the lineup</h3>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Player cards</span>
            <span className="text-muted-foreground">Tap individual player cards to toggle them on/off field. The badge shows <strong className="text-foreground">X / 7 on field</strong> for 7v7 or <strong className="text-foreground">X / 4 on field</strong> for 4v4 — green when the exact number is selected.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Lineup warning</span>
            <span className="text-muted-foreground">If more players are on field than allowed (or, with Ratio on, too many of one gender), a red or orange banner appears with a chip for each player on field. It never blocks you, so you can add a player first and remove another after. Tap a chip&apos;s <strong className="text-foreground">✕</strong> to remove that player; the banner disappears once the lineup is correct.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Line buttons</span>
            <span className="text-muted-foreground">Tap <strong className="text-foreground">Line 1 / Line 2 / Line 3</strong> to set the entire line on field at once. Injured players are automatically excluded. With the default splits, a 7v7 line has 8 players to choose from and a 4v4 line has 4.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">⚡ Preset lines</span>
            <span className="text-muted-foreground">Tap a named preset (e.g. <strong className="text-foreground">Power O</strong>) to instantly set those players. Preset buttons appear above the line buttons when presets exist. See <em>Line Presets</em> below for how to create them.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Navigate points</span>
            <span className="text-muted-foreground">Use the point strip at the top of the live panel to jump to any point and review or edit the lineup and stats.</span>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-foreground pt-1">Stats panel</h3>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Open stats</span>
            <span className="text-muted-foreground">The stats panel opens automatically when we score. It also has its own score buttons at the top right so you can score and record stats without scrolling.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Goal &amp; assist</span>
            <span className="text-muted-foreground">Tap the player who caught the disc (Goal Scorer) and the thrower (Assist). Only on-field players are listed.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Player stats</span>
            <span className="text-muted-foreground">Use + / − to record D-blocks, throwaways, and drops per player for the current point.</span>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-foreground pt-1">Timeouts</h3>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Track timeouts</span>
            <span className="text-muted-foreground">Track 1st and 2nd half timeouts for both teams using the timeout panel below the lineup.</span>
          </div>
        </div>
      </section>

      {/* Line Presets */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>⚡</span> Line Presets
        </h2>
        <p className="text-sm text-muted-foreground">
          Save named lineups (e.g. <strong className="text-foreground">Power O</strong>, <strong className="text-foreground">Power D</strong>, <strong className="text-foreground">Zone D</strong>) for quick selection during a game. Presets are saved with the sheet and copied when you use it as a template.
        </p>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Open manager</span>
            <span className="text-muted-foreground">Click <strong className="text-foreground">⚡ Presets</strong> in the toolbar to open the preset manager panel.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Create preset</span>
            <span className="text-muted-foreground">Type a name, then tap up to 7 players (7v7) or 4 players (4v4) from the roster picker (pink dot = FMP, blue = MMP). In live mode, <strong className="text-foreground">Use current point</strong> fills the selection from whoever is on field. Tap <strong className="text-foreground">Save Preset</strong>.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Rename / delete</span>
            <span className="text-muted-foreground">Use the ✏️ icon to rename a preset inline, or ✕ to delete it.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Apply in game</span>
            <span className="text-muted-foreground">In live mode, preset buttons appear above Line 1/2/3. Tap a preset to set those players on field for the current point (max 7 for 7v7, 4 for 4v4; injured players skipped). The button turns amber when active.</span>
          </div>
        </div>
      </section>

      {/* Gender ratio */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>⚥</span> Gender Ratio Enforcement
        </h2>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">7v7:</strong> the gender ratio alternates each point: one gender has 4 players on for 1 point, then the other gender has 4 for the next 2, then back — the ABBAABBAA pattern.
          For example, starting 4F/3M: point 1 = 4F/3M, point 2 = 3F/4M, point 3 = 3F/4M, point 4 = 4F/3M, and so on.
        </p>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">4v4:</strong> the ratio is fixed every point — always <strong className="text-pink-600">2F</strong>/<strong className="text-blue-600">2M</strong>. There is no alternating pattern and no starting ratio to choose.
        </p>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Enable</span>
            <span className="text-muted-foreground">Tap <strong className="text-pink-600">⚥ Ratio Off</strong> to turn enforcement on. The button turns pink when active.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Starting ratio</span>
            <span className="text-muted-foreground"><strong className="text-foreground">7v7 only.</strong> Tap the ratio toggle button to set whether point 1 starts with <strong className="text-pink-600">4F/3M</strong> (pink) or <strong className="text-blue-600">3F/4M</strong> (blue). The pattern alternates automatically from there. This toggle is not shown for 4v4.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Ratio badge</span>
            <span className="text-muted-foreground">Next to the on-field player count, a badge shows the current FMP/MMP split. <strong className="text-pink-600">Pink ✓</strong> = correct ratio, <strong className="text-orange-500">Orange ⚠</strong> = wrong split, <strong className="text-muted-foreground">Grey</strong> = fewer than 7 (7v7) or 4 (4v4) players selected (hover for expected ratio).</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">FMP as MMP</span>
            <span className="text-muted-foreground">If you tap an FMP player when the FMP quota is already full (e.g. a third FMP in 4v4), a confirmation prompt appears: <em>FMP playing as MMP-matching</em>. Tap <strong className="text-foreground">Confirm</strong> to add them anyway, or <strong className="text-foreground">Cancel</strong> to choose someone else.</span>
          </div>
        </div>
      </section>

      {/* Stats page */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>📈</span> Season Stats Page
        </h2>
        <p className="text-sm text-muted-foreground">
          The <strong className="text-foreground">📈 Stats</strong> page aggregates results across all your game sheets.
        </p>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Games tab</span>
            <span className="text-muted-foreground">All games grouped by tournament. Each row shows opponent, score, W/L, holds, breaks, and hold%. Subtotals per tournament and a season totals row at the bottom. Only <strong className="text-foreground">archived</strong> sheets count toward W/L record — active sheets show as <em>In Progress</em>.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Players tab</span>
            <span className="text-muted-foreground">Season leaderboard sorted by points played. Shows goals, assists, D-blocks, throwaways, and drops aggregated across all sheets.</span>
          </div>
        </div>
      </section>

      {/* Per-game summary */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>📊</span> Game Summary
        </h2>
        <p className="text-sm text-muted-foreground">
          Tap <strong className="text-foreground">📊 Summary &amp; Stats</strong> on any sheet to open the per-game summary. It shows the final score, holds/breaks breakdown, and a full per-player stat table with goals, assists, D-blocks, throwaways, drops, O-line/D-line splits, and point +/−.
        </p>
      </section>

      {/* Offline */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <span>📶</span> Offline Use
        </h2>
        <p className="text-sm text-muted-foreground">
          The app works offline. Changes are saved locally and synced to the server when you are back online. The sync badge in the top-right corner shows the current status.
        </p>
        <div className="rounded-lg border border-border divide-y divide-border text-sm">
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Precache</span>
            <span className="text-muted-foreground">Before heading to a venue with no internet, click the <strong className="text-foreground">📥 Precache</strong> button in the sync badge to save all current sheets and roster to your device.</span>
          </div>
          <div className="p-3 flex gap-3">
            <span className="font-semibold text-foreground w-36 shrink-0">Install as app</span>
            <span className="text-muted-foreground">On iOS: tap the Share button then <strong className="text-foreground">Add to Home Screen</strong>. On Android: tap the browser menu then <strong className="text-foreground">Install App</strong>.</span>
          </div>
        </div>
      </section>
    </div>
  )
}
