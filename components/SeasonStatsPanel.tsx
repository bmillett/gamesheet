"use client"

/**
 * components/SeasonStatsPanel.tsx
 *
 * Read-only season stats view. Shows season record, top-3 leader boards,
 * and a full sortable player leaderboard — finalized sheets only.
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
  sheets: GameSheetRow[], // should already be pre-filtered to finalized, non-excluded
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PlayerSortField = "displayName" | "gamesPlayed" | "pointsPlayed" | "plusMinus" | "totalPoints" | "goals" | "assists" | "dBlocks" | "throwaways" | "drops"
type SortDirection = "asc" | "desc"
type StatDisplayMode = "totals" | "perGame" | "perPoint"

function getPlayerSortValue(ps: PlayerSeasonStats, field: PlayerSortField, mode: StatDisplayMode): number {
  if (field === "displayName") return 0
  if (field === "gamesPlayed") return ps.gamesPlayed
  const raw = ps[field]
  if (mode === "perGame") return ps.gamesPlayed === 0 ? 0 : raw / ps.gamesPlayed
  if (mode === "perPoint") return ps.pointsPlayed === 0 ? 0 : raw / ps.pointsPlayed
  return raw
}

export function SeasonStatsPanel({ teamName, sheets, players }: SeasonStatsPanelProps) {
  // All finalized sheets (isArchived). Non-finalized are excluded entirely from stats.
  const finalizedSheets = useMemo(
    () => sheets.filter((s) => s.sheet_data.isArchived),
    [sheets]
  )
  // Finalized sheets that count toward stats (excludeFromStats === false/undefined)
  const includedSheets = useMemo(
    () => finalizedSheets.filter((s) => !s.sheet_data.excludeFromStats),
    [finalizedSheets]
  )

  const includedGameStats = useMemo(() => includedSheets.map(deriveGameStats), [includedSheets])
  const playerStats = useMemo(() => aggregatePlayerStats(includedSheets, players), [includedSheets, players])
  const [expandedNotePlayer, setExpandedNotePlayer] = useState<string | null>(null)
  const [statMode, setStatMode] = useState<StatDisplayMode>("totals")
  const [sortField, setSortField] = useState<PlayerSortField>("pointsPlayed")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const isPerGame = statMode === "perGame"
  const isPerPoint = statMode === "perPoint"

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
        const valA = getPlayerSortValue(a, sortField, statMode)
        const valB = getPlayerSortValue(b, sortField, statMode)
        cmp = valA - valB
      }

      if (cmp === 0) {
        // Secondary sort: points played desc, then name asc
        cmp = b.pointsPlayed - a.pointsPlayed || a.displayName.localeCompare(b.displayName)
      }

      return sortDirection === "asc" ? cmp : -cmp
    })
  }, [playerStats, sortField, sortDirection, statMode])

  // Season record — from included game stats
  const seasonWins = includedGameStats.filter((gs) => gs.ourScore > gs.theirScore).length
  const seasonLosses = includedGameStats.filter((gs) => gs.theirScore > gs.ourScore).length
  const seasonTies = includedGameStats.filter((gs) => gs.ourScore === gs.theirScore && gs.totalPoints > 0).length

  // Top-3 leader boards derived from player stats
  const top3Points = useMemo(
    () => [...playerStats].sort((a, b) => b.totalPoints - a.totalPoints || b.goals - a.goals).slice(0, 3),
    [playerStats]
  )
  const top3DBlocks = useMemo(
    () => [...playerStats].sort((a, b) => b.dBlocks - a.dBlocks).slice(0, 3).filter((p) => p.dBlocks > 0),
    [playerStats]
  )
  const top3Throwaways = useMemo(
    () => [...playerStats].sort((a, b) => b.throwaways - a.throwaways).slice(0, 3).filter((p) => p.throwaways > 0),
    [playerStats]
  )

  if (sheets.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        No game sheets yet. Head to{" "}
        <a href="/sheet" className="underline text-primary">Sheets</a> to create your first game.
      </div>
    )
  }

  if (finalizedSheets.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        No finalized games yet. Finalize a game sheet to see stats here.
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">📈 Season Stats</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{teamName} — finalized games</p>
        </div>
        {includedGameStats.length > 0 && (
          <div className="text-right">
            <div className="text-2xl font-extrabold text-foreground">
              {seasonWins}–{seasonLosses}{seasonTies > 0 ? `–${seasonTies}` : ""}
            </div>
            <div className="text-xs text-muted-foreground">W–L record</div>
          </div>
        )}
      </div>

      {/* Top-3 leader boards */}
      {playerStats.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {/* Points leaders (G+A) */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/60 border-b border-border">
              <span className="font-semibold text-xs text-foreground uppercase tracking-wide">🏆 Points (G+A)</span>
            </div>
            <div className="divide-y divide-border/50">
              {top3Points.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">No data yet</p>
              ) : top3Points.map((ps, i) => (
                <div key={ps.playerId} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <span className="text-xs font-medium text-foreground truncate">{ps.displayName}</span>
                  </div>
                  <span className="text-sm font-extrabold tabular-nums text-foreground ml-2 shrink-0">{ps.totalPoints}</span>
                </div>
              ))}
            </div>
          </div>

          {/* D-Block leaders */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/60 border-b border-border">
              <span className="font-semibold text-xs text-foreground uppercase tracking-wide">🛡 D-Blocks</span>
            </div>
            <div className="divide-y divide-border/50">
              {top3DBlocks.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">No data yet</p>
              ) : top3DBlocks.map((ps, i) => (
                <div key={ps.playerId} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <span className="text-xs font-medium text-foreground truncate">{ps.displayName}</span>
                  </div>
                  <span className="text-sm font-extrabold tabular-nums text-foreground ml-2 shrink-0">{ps.dBlocks}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Throwaways leaders */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/60 border-b border-border">
              <span className="font-semibold text-xs text-foreground uppercase tracking-wide">💸 Throwaways</span>
            </div>
            <div className="divide-y divide-border/50">
              {top3Throwaways.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">No data yet</p>
              ) : top3Throwaways.map((ps, i) => (
                <div key={ps.playerId} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <span className="text-xs font-medium text-foreground truncate">{ps.displayName}</span>
                  </div>
                  <span className="text-sm font-extrabold tabular-nums text-foreground ml-2 shrink-0">{ps.throwaways}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Player leaderboard */}
      {playerStats.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-2.5 bg-muted/60 border-b border-border gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground">Player Leaderboard</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">finalized games only</span>
            </div>

            {/* Totals / Per Game / Per Point toggle */}
            <div className="flex items-center gap-1 bg-background/80 dark:bg-muted/40 p-0.5 rounded-lg border border-border text-xs self-start sm:self-auto">
              {(["totals", "perGame", "perPoint"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStatMode(mode)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    statMode === mode
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "totals" ? "Totals" : mode === "perGame" ? "Per Game" : "Per Point"}
                </button>
              ))}
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
                    { key: "plusMinus" as const, label: isPerGame ? "+/-/G" : isPerPoint ? "+/-/Pt" : "+/-", align: "text-center" },
                    { key: "totalPoints" as const, label: isPerGame ? "G+A/G" : isPerPoint ? "G+A/Pt" : "G+A", align: "text-center" },
                    { key: "goals" as const, label: isPerGame ? "Goals/G" : isPerPoint ? "Goals/Pt" : "Goals", align: "text-center" },
                    { key: "assists" as const, label: isPerGame ? "Assists/G" : isPerPoint ? "Assists/Pt" : "Assists", align: "text-center" },
                    { key: "dBlocks" as const, label: isPerGame ? "Blocks/G" : isPerPoint ? "Blocks/Pt" : "Blocks", align: "text-center" },
                    { key: "throwaways" as const, label: isPerGame ? "Turns/G" : isPerPoint ? "Turns/Pt" : "Turns", align: "text-center" },
                    { key: "drops" as const, label: isPerGame ? "Drops/G" : isPerPoint ? "Drops/Pt" : "Drops", align: "text-center" },
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
                  const pp = ps.pointsPlayed || 1

                  // Value formatters
                  const fmt = (n: number) =>
                    isPerGame ? (n / gp).toFixed(2) : isPerPoint ? (n / pp).toFixed(2) : String(n || "—")
                  const ptsVal = isPerGame ? (ps.pointsPlayed / gp).toFixed(1) : ps.pointsPlayed
                  const pmRaw = isPerGame ? ps.plusMinus / gp : isPerPoint ? ps.plusMinus / pp : ps.plusMinus
                  const pmDecimals = (isPerGame || isPerPoint) ? 2 : 0
                  const pmFormatted = pmRaw > 0
                    ? `+${pmRaw.toFixed(pmDecimals)}`
                    : pmRaw < 0
                    ? pmRaw.toFixed(pmDecimals)
                    : (isPerGame || isPerPoint) ? "0.00" : "0"
                  const gPlusAVal = fmt(ps.totalPoints)
                  const goalsVal = fmt(ps.goals)
                  const assistsVal = fmt(ps.assists)
                  const dBlocksVal = fmt(ps.dBlocks)
                  const turnsVal = fmt(ps.throwaways)
                  const dropsVal = fmt(ps.drops)

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
