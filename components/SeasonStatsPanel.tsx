"use client"

/**
 * components/SeasonStatsPanel.tsx
 *
 * Read-only season/tournament stats view. Aggregates all game sheets
 * into per-tournament records and a season-wide player leaderboard.
 */

import React, { useMemo, useState } from "react"
import type { GameSheetData, GameSheetPoint, GameSheetRow, RosterPlayer } from "@/types/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameStats {
  sheet: GameSheetRow
  ourScore: number
  theirScore: number
  ourHolds: number
  ourBreaks: number
  theirHolds: number
  theirBreaks: number
  totalPoints: number
}

interface PlayerSeasonStats {
  playerId: string
  displayName: string
  jerseyNumber: number | null
  gender: string
  gamesPlayed: number
  pointsPlayed: number
  goals: number
  assists: number
  totalPoints: number // Goals + Assists (G+A)
  dBlocks: number
  throwaways: number
  drops: number
  plusMinus: number // (Goals + Assists + D-Blocks) - (Turns + Drops)
  /** Notes keyed by game label (opponent / sheet title) */
  notes: { gameLabel: string; note: string }[]
}

interface TournamentGroup {
  tournamentName: string // "" means "Other Games"
  games: GameStats[]
}

interface SeasonStatsPanelProps {
  teamName: string
  sheets: GameSheetRow[]
  players: RosterPlayer[]
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function deriveGameStats(sheet: GameSheetRow): GameStats {
  const data: GameSheetData = sheet.sheet_data
  let ourScore = 0
  let theirScore = 0
  let ourHolds = 0
  let ourBreaks = 0
  let theirHolds = 0
  let theirBreaks = 0

  const startPoss = data.startingPossession || "offense"

  data.points.forEach((pt: GameSheetPoint, idx: number) => {
    if (pt.scorer === "us") ourScore++
    if (pt.scorer === "them") theirScore++

    let expectedPoss: "offense" | "defense" = startPoss
    if (idx > 0) {
      const prev = data.points[idx - 1]
      if (prev.scorer === "us") expectedPoss = "defense"
      else if (prev.scorer === "them") expectedPoss = "offense"
    }

    if (pt.scorer === "us") {
      if (pt.isCleanHold || (expectedPoss === "offense" && !pt.isCleanBreak)) {
        ourHolds++
      } else if (pt.isCleanBreak || expectedPoss === "defense") {
        ourBreaks++
      }
    } else if (pt.scorer === "them") {
      if (expectedPoss === "defense") {
        theirHolds++
      } else {
        theirBreaks++
      }
    }
  })

  return {
    sheet,
    ourScore,
    theirScore,
    ourHolds,
    ourBreaks,
    theirHolds,
    theirBreaks,
    totalPoints: ourScore + theirScore,
  }
}

function aggregatePlayerStats(
  sheets: GameSheetRow[],
  rosterPlayers: RosterPlayer[]
): PlayerSeasonStats[] {
  const statsMap = new Map<string, PlayerSeasonStats>()

  // Seed with all roster players so everyone shows even with 0 stats
  rosterPlayers.forEach((rp) => {
    statsMap.set(rp.id, {
      playerId: rp.id,
      displayName: rp.display_name,
      jerseyNumber: rp.jersey_number,
      gender: rp.gender,
      gamesPlayed: 0,
      pointsPlayed: 0,
      goals: 0,
      assists: 0,
      totalPoints: 0,
      dBlocks: 0,
      throwaways: 0,
      drops: 0,
      plusMinus: 0,
      notes: [],
    })
  })

  sheets.forEach((sheet) => {
    const data = sheet.sheet_data
    const startPoss = data.startingPossession || "offense"

    // Build a playerId → displayName map from this sheet's player slots
    // (handles players removed from roster but recorded in old sheets)
    const sheetPlayerNames = new Map<string, string>()
    data.players.forEach((p) => {
      if (p?.playerId) sheetPlayerNames.set(p.playerId, p.displayName)
    })

    const playersInThisGame = new Set<string>()

    data.points.forEach((pt: GameSheetPoint, idx: number) => {
      let expectedPoss: "offense" | "defense" = startPoss
      if (idx > 0) {
        const prev = data.points[idx - 1]
        if (prev.scorer === "us") expectedPoss = "defense"
        else if (prev.scorer === "them") expectedPoss = "offense"
      }

      pt.playerIds.forEach((pid) => {
        if (!statsMap.has(pid)) {
          // Player not in current roster — still track them
          statsMap.set(pid, {
            playerId: pid,
            displayName: sheetPlayerNames.get(pid) ?? pid,
            jerseyNumber: null,
            gender: "",
            gamesPlayed: 0,
            pointsPlayed: 0,
            goals: 0,
            assists: 0,
            totalPoints: 0,
            dBlocks: 0,
            throwaways: 0,
            drops: 0,
            plusMinus: 0,
            notes: [],
          })
        }
        playersInThisGame.add(pid)
        const entry = statsMap.get(pid)!
        entry.pointsPlayed++
      })

      if (pt.scorer === "us" && pt.goalScorerId) {
        const entry = statsMap.get(pt.goalScorerId)
        if (entry) entry.goals++
      }

      if (pt.assistPlayerId) {
        const entry = statsMap.get(pt.assistPlayerId)
        if (entry) entry.assists++
      }

      if (pt.playerStats) {
        Object.entries(pt.playerStats).forEach(([pid, ps]) => {
          const entry = statsMap.get(pid)
          if (entry) {
            entry.dBlocks += ps.dBlocks
            entry.throwaways += ps.throwaways
            entry.drops += ps.drops
          }
        })
      }
    })

    // Collect per-player notes from this sheet
    if (data.playerNotes) {
      const gameLabel = sheet.sheet_data.customTitle?.trim()
        || (sheet.opponent_name?.trim() ? `vs ${sheet.opponent_name.trim()}` : null)
        || sheet.id.slice(0, 6)
      Object.entries(data.playerNotes).forEach(([pid, note]) => {
        if (!note.trim()) return
        const entry = statsMap.get(pid)
        if (entry) {
          entry.notes.push({ gameLabel, note: note.trim() })
        }
      })
    }

    // Increment games played for everyone who logged at least 1 point in this sheet
    playersInThisGame.forEach((pid) => {
      const entry = statsMap.get(pid)
      if (entry) {
        entry.gamesPlayed++
      }
    })
  })

  return Array.from(statsMap.values())
    .filter((s) => s.pointsPlayed > 0)
    .map((s) => {
      s.totalPoints = s.goals + s.assists
      s.plusMinus = s.goals + s.assists + s.dBlocks - (s.throwaways + s.drops)
      return s
    })
    .sort((a, b) => b.pointsPlayed - a.pointsPlayed || (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999))
}

function pct(num: number, den: number): string {
  if (den === 0) return "—"
  return Math.round((num / den) * 100) + "%"
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PlayerSortField = "displayName" | "gamesPlayed" | "pointsPlayed" | "plusMinus" | "totalPoints" | "goals" | "assists" | "dBlocks" | "throwaways" | "drops"
type SortDirection = "asc" | "desc"
type StatDisplayMode = "totals" | "perGame"

function getPlayerSortValue(ps: PlayerSeasonStats, field: PlayerSortField, perGame: boolean): number {
  if (field === "displayName") return 0
  if (field === "gamesPlayed") return ps.gamesPlayed
  const raw = ps[field]
  if (!perGame || ps.gamesPlayed === 0) return raw
  return raw / ps.gamesPlayed
}

export function SeasonStatsPanel({ teamName, sheets, players }: SeasonStatsPanelProps) {
  const gameStats = useMemo(() => sheets.map(deriveGameStats), [sheets])
  const playerStats = useMemo(() => aggregatePlayerStats(sheets, players), [sheets, players])
  const [expandedNotePlayer, setExpandedNotePlayer] = useState<string | null>(null)
  const [statMode, setStatMode] = useState<StatDisplayMode>("totals")
  const [sortField, setSortField] = useState<PlayerSortField>("pointsPlayed")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const isPerGame = statMode === "perGame"

  const handleSort = (field: PlayerSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDirection(field === "displayName" ? "asc" : "desc")
    }
  }

  const sortedPlayerStats = useMemo(() => {
    return [...playerStats].sort((a, b) => {
      let cmp = 0
      if (sortField === "displayName") {
        cmp = a.displayName.localeCompare(b.displayName)
      } else {
        const valA = getPlayerSortValue(a, sortField, isPerGame)
        const valB = getPlayerSortValue(b, sortField, isPerGame)
        cmp = valA - valB
      }

      if (cmp === 0) {
        // Secondary sort: points played desc, then name asc
        cmp = b.pointsPlayed - a.pointsPlayed || a.displayName.localeCompare(b.displayName)
      }

      return sortDirection === "asc" ? cmp : -cmp
    })
  }, [playerStats, sortField, sortDirection, isPerGame])

  // Group by tournament — null / "" → "Other Games"
  const tournamentGroups = useMemo<TournamentGroup[]>(() => {
    const map = new Map<string, GameStats[]>()
    gameStats.forEach((gs) => {
      const key = gs.sheet.tournament_name?.trim() || ""
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(gs)
    })

    // Named tournaments first (sorted), then "Other Games"
    const named = Array.from(map.entries())
      .filter(([k]) => k !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, games]) => ({ tournamentName: k, games }))

    const other = map.get("")
    if (other && other.length > 0) {
      named.push({ tournamentName: "", games: other })
    }
    return named
  }, [gameStats])

  // Season totals (archived games only)
  const archivedStats = gameStats.filter((gs) => gs.sheet.sheet_data.isArchived)
  const seasonWins = archivedStats.filter((gs) => gs.ourScore > gs.theirScore).length
  const seasonLosses = archivedStats.filter((gs) => gs.theirScore > gs.ourScore).length
  const seasonTies = archivedStats.filter((gs) => gs.ourScore === gs.theirScore && gs.totalPoints > 0).length
  const seasonOurScore = archivedStats.reduce((s, g) => s + g.ourScore, 0)
  const seasonTheirScore = archivedStats.reduce((s, g) => s + g.theirScore, 0)
  const seasonHolds = archivedStats.reduce((s, g) => s + g.ourHolds, 0)
  const seasonBreaks = archivedStats.reduce((s, g) => s + g.ourBreaks, 0)
  const seasonTheirOffPts = archivedStats.reduce((s, g) => s + g.ourHolds + g.theirBreaks, 0)
  const seasonOurDefPts = archivedStats.reduce((s, g) => s + g.ourBreaks + g.theirHolds, 0)

  if (sheets.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        No game sheets yet. Head to{" "}
        <a href="/sheet" className="underline text-primary">Sheets</a> to create your first game.
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">📈 Season Stats</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{teamName} — all game sheets</p>
        </div>
        {archivedStats.length > 0 && (
          <div className="text-right">
            <div className="text-2xl font-extrabold text-foreground">
              {seasonWins}–{seasonLosses}{seasonTies > 0 ? `–${seasonTies}` : ""}
            </div>
            <div className="text-xs text-muted-foreground">Record (finalized games)</div>
          </div>
        )}
      </div>

      {/* Tournament groups */}
      {tournamentGroups.map((group) => {
        const groupArchived = group.games.filter((g) => g.sheet.sheet_data.isArchived)
        const gW = groupArchived.filter((g) => g.ourScore > g.theirScore).length
        const gL = groupArchived.filter((g) => g.theirScore > g.ourScore).length
        const gT = groupArchived.filter((g) => g.ourScore === g.theirScore && g.totalPoints > 0).length
        const gOurTot = groupArchived.reduce((s, g) => s + g.ourScore, 0)
        const gTheirTot = groupArchived.reduce((s, g) => s + g.theirScore, 0)

        return (
          <div key={group.tournamentName || "__other__"} className="rounded-xl border border-border overflow-hidden">
            {/* Tournament header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/60 border-b border-border">
              <span className="font-semibold text-sm text-foreground">
                {group.tournamentName || "Other Games"}
              </span>
              {groupArchived.length > 0 && (
                <span className="text-xs text-muted-foreground font-medium">
                  {gW}–{gL}{gT > 0 ? `–${gT}` : ""} &nbsp;·&nbsp; {gOurTot}–{gTheirTot}
                </span>
              )}
            </div>

            {/* Game rows */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground uppercase tracking-wide">
                    <th className="px-3 py-2 text-left font-semibold">Opponent</th>
                    <th className="px-3 py-2 text-center font-semibold">Score</th>
                    <th className="px-3 py-2 text-center font-semibold">W/L</th>
                    <th className="px-3 py-2 text-center font-semibold">Holds</th>
                    <th className="px-3 py-2 text-center font-semibold">Hold%</th>
                    <th className="px-3 py-2 text-center font-semibold">Breaks</th>
                    <th className="px-3 py-2 text-center font-semibold">Break%</th>
                  </tr>
                </thead>
                <tbody>
                  {group.games.map((gs) => {
                    const isArchived = gs.sheet.sheet_data.isArchived
                    const isWin = gs.ourScore > gs.theirScore
                    const isLoss = gs.theirScore > gs.ourScore
                    const ourOffPts = gs.ourHolds + gs.theirBreaks
                    const ourDefPts = gs.ourBreaks + gs.theirHolds
                    const opponentName = gs.sheet.opponent_name?.trim() || "Unknown Opponent"

                    return (
                      <tr key={gs.sheet.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-medium text-foreground">
                          {opponentName}
                          {gs.sheet.field && (
                            <span className="ml-1.5 text-muted-foreground font-normal">({gs.sheet.field})</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center font-bold tabular-nums">
                          {isArchived ? (
                            <span className={isWin ? "text-emerald-600 dark:text-emerald-400" : isLoss ? "text-rose-600 dark:text-rose-400" : "text-foreground"}>
                              {gs.ourScore}–{gs.theirScore}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{gs.ourScore}–{gs.theirScore}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {!isArchived ? (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold">
                              In Progress
                            </span>
                          ) : gs.totalPoints === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : isWin ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold">W</span>
                          ) : isLoss ? (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400 font-bold">L</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-bold">T</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums text-foreground">{gs.ourHolds}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{pct(gs.ourHolds, ourOffPts)}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-foreground">{gs.ourBreaks}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{pct(gs.ourBreaks, ourDefPts)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Tournament subtotals (archived only) */}
                {groupArchived.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
                      <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Subtotal</td>
                      <td className="px-3 py-2 text-center tabular-nums">{gOurTot}–{gTheirTot}</td>
                      <td className="px-3 py-2 text-center">{gW}–{gL}{gT > 0 ? `–${gT}` : ""}</td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {groupArchived.reduce((s, g) => s + g.ourHolds, 0)}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                        {pct(
                          groupArchived.reduce((s, g) => s + g.ourHolds, 0),
                          groupArchived.reduce((s, g) => s + g.ourHolds + g.theirBreaks, 0)
                        )}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {groupArchived.reduce((s, g) => s + g.ourBreaks, 0)}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                        {pct(
                          groupArchived.reduce((s, g) => s + g.ourBreaks, 0),
                          groupArchived.reduce((s, g) => s + g.ourBreaks + g.theirHolds, 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      })}

      {/* Season totals */}
      {archivedStats.length > 0 && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-primary/20 bg-primary/10">
            <span className="font-bold text-sm text-foreground">Season Totals (finalized games)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
            {[
              { label: "Record", value: `${seasonWins}–${seasonLosses}${seasonTies > 0 ? `–${seasonTies}` : ""}` },
              { label: "Score", value: `${seasonOurScore}–${seasonTheirScore}` },
              { label: `Hold% (${seasonHolds} holds)`, value: pct(seasonHolds, seasonTheirOffPts) },
              { label: `Break% (${seasonBreaks} breaks)`, value: pct(seasonBreaks, seasonOurDefPts) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-card px-4 py-3 text-center">
                <div className="text-lg font-extrabold text-foreground tabular-nums">{value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player leaderboard */}
      {playerStats.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-2.5 bg-muted/60 border-b border-border gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground">Player Leaderboard</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">all sheets including in-progress</span>
            </div>

            {/* Totals vs Per Game toggle */}
            <div className="flex items-center gap-1 bg-background/80 dark:bg-muted/40 p-0.5 rounded-lg border border-border text-xs self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setStatMode("totals")}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statMode === "totals"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Totals
              </button>
              <button
                type="button"
                onClick={() => setStatMode("perGame")}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statMode === "perGame"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Per Game
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground uppercase tracking-wide select-none">
                  {([
                    { key: "displayName" as const, label: "Player", align: "text-left" },
                    { key: "gamesPlayed" as const, label: "GP", align: "text-center" },
                    { key: "pointsPlayed" as const, label: isPerGame ? "Pts/G" : "Pts", align: "text-center" },
                    { key: "plusMinus" as const, label: isPerGame ? "+/-/G" : "+/-", align: "text-center" },
                    { key: "totalPoints" as const, label: isPerGame ? "G+A/G" : "G+A", align: "text-center" },
                    { key: "goals" as const, label: isPerGame ? "Goals/G" : "Goals", align: "text-center" },
                    { key: "assists" as const, label: isPerGame ? "Assists/G" : "Assists", align: "text-center" },
                    { key: "dBlocks" as const, label: isPerGame ? "Blocks/G" : "Blocks", align: "text-center" },
                    { key: "throwaways" as const, label: isPerGame ? "Turns/G" : "Turns", align: "text-center" },
                    { key: "drops" as const, label: isPerGame ? "Drops/G" : "Drops", align: "text-center" },
                  ]).map(({ key, label, align }) => {
                    const isActive = sortField === key
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className={`px-3 py-2 ${align} font-semibold cursor-pointer hover:bg-muted/60 transition-colors ${
                          isActive ? "text-foreground font-bold bg-muted/40" : ""
                        }`}
                        title={`Sort by ${label} (${isActive && sortDirection === "asc" ? "descending" : "ascending"})`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          <span className={`text-[10px] ${isActive ? "text-primary opacity-100" : "opacity-30"}`}>
                            {isActive ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                          </span>
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedPlayerStats.map((ps, i) => {
                  const isExpanded = expandedNotePlayer === ps.playerId
                  const rowBg = i % 2 === 0 ? "" : "bg-muted/10"
                  const gp = ps.gamesPlayed || 1

                  // Value formatters
                  const ptsVal = isPerGame ? (ps.pointsPlayed / gp).toFixed(1) : ps.pointsPlayed
                  const pmRaw = isPerGame ? ps.plusMinus / gp : ps.plusMinus
                  const pmFormatted = isPerGame ? (pmRaw > 0 ? `+${pmRaw.toFixed(1)}` : pmRaw < 0 ? pmRaw.toFixed(1) : "0.0") : (pmRaw > 0 ? `+${pmRaw}` : `${pmRaw}`)
                  const gPlusAVal = isPerGame ? (ps.totalPoints / gp).toFixed(1) : (ps.totalPoints || "—")
                  const goalsVal = isPerGame ? (ps.goals / gp).toFixed(1) : (ps.goals || "—")
                  const assistsVal = isPerGame ? (ps.assists / gp).toFixed(1) : (ps.assists || "—")
                  const dBlocksVal = isPerGame ? (ps.dBlocks / gp).toFixed(1) : (ps.dBlocks || "—")
                  const turnsVal = isPerGame ? (ps.throwaways / gp).toFixed(1) : (ps.throwaways || "—")
                  const dropsVal = isPerGame ? (ps.drops / gp).toFixed(1) : (ps.drops || "—")

                  return (
                    <React.Fragment key={ps.playerId}>
                      <tr className={`border-b border-border/50 ${ps.notes.length > 0 && isExpanded ? "" : "last:border-0"} ${rowBg}`}>
                        <td className="px-3 py-2 font-medium text-foreground">
                          <span className="tabular-nums text-muted-foreground mr-1.5">
                            {ps.jerseyNumber != null ? `#${ps.jerseyNumber}` : ""}
                          </span>
                          {ps.displayName}
                          {ps.gender && (
                            <span className="ml-1.5 text-xs text-muted-foreground">({ps.gender})</span>
                          )}
                          {ps.notes.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedNotePlayer(isExpanded ? null : ps.playerId)}
                              className="ml-2 text-xs text-violet-600 dark:text-violet-400 hover:underline font-medium"
                              title={isExpanded ? "Hide coaching notes" : "Show coaching notes"}
                            >
                              📝 {ps.notes.length} note{ps.notes.length !== 1 ? "s" : ""}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums text-muted-foreground font-medium">{ps.gamesPlayed}</td>
                        <td className="px-3 py-2 text-center font-bold tabular-nums text-foreground">{ptsVal}</td>
                        <td className="px-3 py-2 text-center tabular-nums font-semibold">
                          {pmRaw > 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400">{pmFormatted}</span>
                          ) : pmRaw < 0 ? (
                            <span className="text-rose-600 dark:text-rose-400">{pmFormatted}</span>
                          ) : (
                            <span className="text-muted-foreground">{isPerGame ? "0.0" : "0"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums font-semibold text-foreground">
                          {gPlusAVal}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums text-foreground">{goalsVal}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-foreground">{assistsVal}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-foreground">{dBlocksVal}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-foreground">{turnsVal}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-foreground">{dropsVal}</td>
                      </tr>
                      {ps.notes.length > 0 && isExpanded && (
                        <tr className={`border-b border-border/50 last:border-0 ${rowBg}`}>
                          <td colSpan={10} className="px-4 py-2.5">
                            <div className="space-y-1.5">
                              {ps.notes.map(({ gameLabel, note }, ni) => (
                                <div key={ni} className="flex gap-2 text-xs">
                                  <span className="shrink-0 font-semibold text-violet-600 dark:text-violet-400 min-w-[6rem]">
                                    {gameLabel}
                                  </span>
                                  <span className="text-foreground whitespace-pre-wrap">{note}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
