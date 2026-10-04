"use client"

/**
 * components/coaches/GameSheet.tsx
 *
 * Interactive and printable game sheet for ultimate frisbee.
 *
 * Features:
 * 1. 24 guaranteed rows (numbered 1–24) with blank/assigned slots.
 * 2. Draggable / Clickable Roster:
 *    - Unassigned player bench/pool at the top.
 *    - Drag players from bench to slot/line, drag within sheet to swap/reorder.
 * 3. Coaches excluded from player pool (players/alpha leaders only).
 * 4. Moveable line dividers with presets: 3 Lines 8/8/8 (default), 3 Lines 10/7/7, 2 Lines 12/12, No Split.
 * 5. Player Point Totals Column (Pts): Real-time sum of points played per player.
 * 6. Live "Game Mode" Toggle:
 *    - Large, high-contrast sideline UI optimized for tablets and phones.
 *    - Quick point scorer buttons (+1 Ignite / +1 Opponent), Hold / Break toggles.
 *    - Point navigation & live roster substitution checkboxes.
 * 7. Active / Archived Filter & Historical Management:
 *    - Filter tabs: Active Sheets vs Archived Sheets.
 *    - Finalize / Archive / Unarchive toggle.
 *    - Duplicate / Use as Template (copies roster setup & dividers to a fresh game).
 *    - Sheet title & opponent name instant reactive update.
 *    - Delete sheet with confirmation modal.
 * 8. Paper-ready bottom tracking & single-page landscape print layout.
 */

import React, { useState, useTransition, useCallback, useEffect } from "react"
import {
  createSheetAction,
  updateSheetAction,
  deleteSheetAction,
  duplicateSheetAction,
} from "@/lib/data/actions"
import { syncEngine } from "@/lib/offline/sync-engine"
import { saveCachedRoster, getLocalSheet, saveLocalSheet } from "@/lib/offline/db"
import { triggerHaptic } from "@/lib/utils/haptics"
import { getExpectedRatio, countGenders, getRatioStatus, isFmpAsMmp } from "@/lib/utils/gender-ratio"
import type { StartingRatio } from "@/lib/utils/gender-ratio"
import { getTeamConfig } from "@/lib/utils/team-config"
import { SyncStatusBadge } from "@/components/SyncStatusBadge"
import { GameSummaryModal } from "@/components/GameSummaryModal"
import type {
  GameSheetData,
  GameSheetPlayer,
  GameSheetPoint,
  PlayerPointStats,
  RosterPlayer,
} from "@/types/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function abbreviatePosition(pos: string | null | undefined): string {
  if (!pos) return ""
  const normalized = pos.trim().toLowerCase()
  if (normalized === "handler" || normalized === "h") return "H"
  if (normalized === "cutter" || normalized === "c") return "C"
  if (normalized === "hybrid" || normalized === "hy") return "HY"
  return pos.toUpperCase()
}

function emptyPoint(n: number): GameSheetPoint {
  return { pointNumber: n, playerIds: [], isCleanHold: false, isCleanBreak: false, scorer: null }
}

function normalizePlayers(rawPlayers: GameSheetPlayer[], totalSlots: number): (GameSheetPlayer | null)[] {
  const slots: (GameSheetPlayer | null)[] = Array.from({ length: totalSlots }, () => null)

  if (rawPlayers && rawPlayers.length > 0) {
    rawPlayers.forEach((p) => {
      if (p && p.playerId) {
        const targetSlot = (typeof p.slotOrder === "number" && p.slotOrder >= 0 && p.slotOrder < totalSlots)
          ? p.slotOrder
          : -1

        if (targetSlot !== -1 && slots[targetSlot] === null) {
          slots[targetSlot] = p
        } else {
          const firstOpen = slots.findIndex((s) => s === null)
          if (firstOpen !== -1) {
            slots[firstOpen] = { ...p, slotOrder: firstOpen }
          }
        }
      }
    })
  }
  return slots
}

function emptyData(defaultDividers: number[]): GameSheetData {
  return {
    players: [],
    points: [],
    ourTimeouts: 0,
    theirTimeouts: 0,
    ourTimeoutsH1: 0,
    ourTimeoutsH2: 0,
    theirTimeoutsH1: 0,
    theirTimeoutsH2: 0,
    lineDividers: defaultDividers,
    isArchived: false,
    customTitle: "",
  }
}

function ensurePoints(data: GameSheetData, upTo: number): GameSheetData {
  if (data.points.length >= upTo) return data
  const extra: GameSheetPoint[] = []
  for (let n = data.points.length + 1; n <= upTo; n++) extra.push(emptyPoint(n))
  return { ...data, points: [...data.points, ...extra] }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerBasic = Pick<RosterPlayer, "id" | "display_name" | "jersey_number" | "position" | "gender">

interface SheetEntry {
  id: string
  opponent_name: string | null
  tournament_name: string | null
  field: string | null
  sheet_data: GameSheetData
}

interface GameSheetProps {
  teamId: string
  teamName?: string
  playersPerSide?: number
  teamPlayers: PlayerBasic[]
  initialSheets: SheetEntry[]
}

function sheetLabel(sheet: SheetEntry): string {
  if (sheet.sheet_data?.customTitle?.trim()) {
    return sheet.sheet_data.customTitle.trim()
  }
  const tournament = sheet.tournament_name
  const opponent = sheet.opponent_name
  if (tournament && opponent) return `${tournament} — vs ${opponent}`
  if (tournament) return tournament
  if (opponent) return `vs ${opponent}`
  return `Game Sheet (${sheet.id.slice(0, 6)})`
}
// ---------------------------------------------------------------------------
// GameSheet Component
// ---------------------------------------------------------------------------

export function GameSheet({ teamId, teamName = "OJ", playersPerSide = 7, teamPlayers, initialSheets }: GameSheetProps) {
  const config = getTeamConfig(playersPerSide)
  const { totalSlots, defaultDividers, dividerPresets, minPoints, defaultPoints, maxPoints } = config
  const [sheets, setSheets] = useState<SheetEntry[]>(initialSheets)

  // Initialize filter: if first sheet is archived, default to all or active
  const [sheetFilter, setSheetFilter] = useState<"all" | "active" | "archived">("active")
  const [gameMode, setGameMode] = useState<boolean>(false)
  const [isGameModeCollapsed, setIsGameModeCollapsed] = useState<boolean>(false)
  const [selectedLivePoint, setSelectedLivePoint] = useState<number>(0) // 0-based point index for live mode
  const [isStatsPanelOpen, setIsStatsPanelOpen] = useState<boolean>(false)
  const [notePopupPlayerId, setNotePopupPlayerId] = useState<string | null>(null)

  const [selectedSheetId, setSelectedSheetId] = useState<string>(() => {
    // Pick first active sheet if available, otherwise first sheet
    const firstActive = initialSheets.find((s) => !s.sheet_data?.isArchived)
    return firstActive?.id ?? initialSheets[0]?.id ?? ""
  })

  function getSheet(id: string): SheetEntry | undefined {
    return sheets.find((s) => s.id === id)
  }

  // Active sheet - if selectedSheetId is not found (e.g. empty or deleted), fallback to first sheet
  const activeSheet = getSheet(selectedSheetId) ?? sheets[0]

  const [data, setData] = useState<GameSheetData>(
    () => activeSheet?.sheet_data ?? emptyData(defaultDividers)
  )
  const [opponentName, setOpponentName] = useState(activeSheet?.opponent_name ?? "")
  const [tournamentName, setTournamentName] = useState(activeSheet?.tournament_name ?? "")
  const [fieldName, setFieldName] = useState(activeSheet?.field ?? "")
  const [sheetTitle, setSheetTitle] = useState(activeSheet?.sheet_data?.customTitle ?? "")
  const [activePoints, setActivePoints] = useState(
    () => activeSheet?.sheet_data?.totalPoints ?? Math.max(activeSheet?.sheet_data?.points?.length ?? 0, defaultPoints)
  )

  const [isPending, startTransition] = useTransition()
  const [createPending, startCreate] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const [clonePending, startClone] = useTransition()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [isPrecaching, setIsPrecaching] = useState(false)

  const [selectedTargetLine, setSelectedTargetLine] = useState<number>(1)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false)
  const [showRosterBench, setShowRosterBench] = useState(true)
  const [showDividerControls, setShowDividerControls] = useState(false)
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [pendingFmpAsMmp, setPendingFmpAsMmp] = useState<{ playerId: string; pointIndex: number } | null>(null)
  const [newPresetName, setNewPresetName] = useState("")
  const [newPresetPlayerIds, setNewPresetPlayerIds] = useState<string[]>([])
  const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [isGridCollapsed, setIsGridCollapsed] = useState(false)
  const [gridWasCollapsedBeforeLive, setGridWasCollapsedBeforeLive] = useState(false)

  // Cache team roster locally for offline access
  useEffect(() => {
    if (teamId && teamPlayers && teamPlayers.length > 0) {
      saveCachedRoster(teamId, teamPlayers).catch(() => {})
    }
  }, [teamId, teamPlayers])

  // Drag state
  const [dragSource, setDragSource] = useState<{ type: "bench"; player: PlayerBasic } | { type: "slot"; index: number } | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Divider lines
  const dividers = data.lineDividers ?? defaultDividers

  // Convert raw players array into fixed slots
  const slots: (GameSheetPlayer | null)[] = normalizePlayers(data.players, totalSlots)

  // ── Switch to a different sheet ─────────────────────────────────────────

  function switchSheet(id: string) {
    const sheet = getSheet(id)
    if (!sheet) return
    setSelectedSheetId(id)
    setData(sheet.sheet_data)
    setActivePoints(
      sheet.sheet_data?.totalPoints ??
      Math.max(sheet.sheet_data?.points?.length ?? 0, defaultPoints)
    )
    setOpponentName(sheet.opponent_name ?? "")
    setTournamentName(sheet.tournament_name ?? "")
    setFieldName(sheet.field ?? "")
    setSheetTitle(sheet.sheet_data?.customTitle ?? "")
    setIsEditingArchived(false)
  }

  // ── Create blank sheet ──────────────────────────────────────────────────

  function handleCreateBlank() {
    startCreate(async () => {
      const result = await createSheetAction(teamId)
      if ("error" in result) { setSaveError(result.error); return }

      const newSheet: SheetEntry = {
        id: result.id,
        opponent_name: null,
        field: null,
        sheet_data: emptyData(defaultDividers),
        tournament_name: null,
      }
      setSheets((prev) => [newSheet, ...prev])
      switchSheet(result.id)
    })
  }

  // ── Duplicate / Use as Template ─────────────────────────────────────────

  function handleDuplicateAsTemplate() {
    if (!selectedSheetId) return
    startClone(async () => {
      const result = await duplicateSheetAction(selectedSheetId, templateName.trim() || undefined)
      if ("error" in result) {
        setSaveError(result.error)
        setShowTemplateModal(false)
        return
      }

      const newSheet: SheetEntry = {
        id: result.id,
        opponent_name: null,
        field: activeSheet?.field ?? null,
        sheet_data: result.sheet_data,
        tournament_name: null,
      }
      setSheets((prev) => [newSheet, ...prev])
      setShowTemplateModal(false)
      setTemplateName("")
      switchSheet(result.id)
    })
  }

  // ── Delete active sheet ─────────────────────────────────────────────────

  function handleDeleteSheet() {
    if (!selectedSheetId) return
    startDelete(async () => {
      const result = await deleteSheetAction(selectedSheetId)
      if ("error" in result) {
        setSaveError(result.error)
        setShowDeleteConfirm(false)
        return
      }

      const remainingSheets = sheets.filter((s) => s.id !== selectedSheetId)
      setSheets(remainingSheets)
      setShowDeleteConfirm(false)

      if (remainingSheets.length > 0) {
        switchSheet(remainingSheets[0].id)
      } else {
        setSelectedSheetId("")
        setData(emptyData(defaultDividers))
      }
    })
  }

  // ── Save ────────────────────────────────────────────────────────────────

  const save = useCallback(
    (patch: Partial<{ opponent_name: string; tournament_name: string; field: string; sheet_data: GameSheetData }>) => {
      if (!selectedSheetId) return

      const targetData = patch.sheet_data || data

      // Instantly update local sheet entry so dropdown titles update without full reload
      setSheets((prev) =>
        prev.map((s) => {
          if (s.id !== selectedSheetId) return s
          return {
            ...s,
            opponent_name: patch.opponent_name !== undefined ? patch.opponent_name : s.opponent_name,
            tournament_name: patch.tournament_name !== undefined ? patch.tournament_name : s.tournament_name,
            field: patch.field !== undefined ? patch.field : s.field,
            sheet_data: targetData,
          }
        })
      )

      // Queue into local IndexedDB and sync engine immediately
      syncEngine.queueSheetUpdate(selectedSheetId, teamId, targetData, {
        opponentName: patch.opponent_name !== undefined ? patch.opponent_name : opponentName,
        tournamentName: patch.tournament_name !== undefined ? patch.tournament_name : tournamentName,
        field: patch.field !== undefined ? patch.field : fieldName,
        isArchived,
      }).catch((err) => {
        console.warn("[GameSheet] Failed to write local offline sheet:", err)
      })

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    },
    [teamId, selectedSheetId, data, opponentName, tournamentName, fieldName, sheets]
  )

  const handlePrecacheTournament = async () => {
    setIsPrecaching(true)
    try {
      if (teamPlayers.length > 0) {
        await saveCachedRoster(teamId, teamPlayers)
      }
      for (const s of sheets) {
        await saveLocalSheet({
          id: s.id,
          team_id: teamId,
          event_id: null,
          opponent_name: s.opponent_name,
          tournament_name: s.tournament_name,
          field: s.field,
          notes: null,
          sheet_data: s.sheet_data,
          updated_at: new Date().toISOString(),
        })
      }
      triggerHaptic("success")
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    } catch (e) {
      console.error("Precache failed", e)
    } finally {
      setIsPrecaching(false)
    }
  }

  function saveData(next: GameSheetData) {
    setData(next)
    save({ sheet_data: next })
  }

  function toggleArchiveStatus() {
    const nextArchived = !data.isArchived
    const nextData = { ...data, isArchived: nextArchived }
    // When unarchiving, unlock editing
    if (!nextArchived) {
      setIsEditingArchived(true)
    } else {
      setIsEditingArchived(false)
    }
    saveData(nextData)
  }

  const isArchived = Boolean(data.isArchived)
  const [isEditingArchived, setIsEditingArchived] = useState<boolean>(false)
  const isReadOnly = isArchived && !isEditingArchived

  const displayData = ensurePoints(data, activePoints)

  // Calculate line group number for each slot
  const sortedDividers = [...dividers].sort((a, b) => a - b)
  function getLineNumber(slotIndex: number): number {
    let line = 1
    for (const div of sortedDividers) {
      if (slotIndex >= div) line++
    }
    return line
  }

  // ── Slot Manipulation & Drag Drop ───────────────────────────────────────

  function handleAssignPlayerToSlot(slotIndex: number, p: PlayerBasic | null) {
    const newSlots = [...slots]
    if (!p) {
      newSlots[slotIndex] = null
    } else {
      for (let i = 0; i < newSlots.length; i++) {
        if (newSlots[i]?.playerId === p.id) {
          newSlots[i] = null
        }
      }
      newSlots[slotIndex] = {
        playerId: p.id,
        displayName: p.display_name ?? p.id,
        jerseyNumber: p.jersey_number,
        position: abbreviatePosition(p.position),
        lineIndex: getLineNumber(slotIndex) - 1,
        slotOrder: slotIndex,
      }
    }
    const playersClean = newSlots.filter((s): s is GameSheetPlayer => s !== null)
    saveData({ ...displayData, players: playersClean })
  }

  function handleDragStartFromSlot(e: React.DragEvent, index: number) {
    setDragSource({ type: "slot", index })
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", `slot:${index}`)
  }

  function handleDragStartFromBench(e: React.DragEvent, player: PlayerBasic) {
    setDragSource({ type: "bench", player })
    e.dataTransfer.effectAllowed = "copyMove"
    e.dataTransfer.setData("text/plain", player.id)
  }

  function handleDragOverSlot(e: React.DragEvent, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverIndex(index)
  }

  function handleDropOnSlot(e: React.DragEvent, dropIndex: number) {
    e.preventDefault()
    setDragOverIndex(null)
    if (!dragSource) return

    const newSlots = [...slots]

    if (dragSource.type === "slot") {
      const sourceIndex = dragSource.index
      if (sourceIndex === dropIndex) return
      const sourcePlayer = newSlots[sourceIndex]
      const targetPlayer = newSlots[dropIndex]

      newSlots[dropIndex] = sourcePlayer
        ? {
            ...sourcePlayer,
            lineIndex: getLineNumber(dropIndex) - 1,
            slotOrder: dropIndex,
          }
        : null

      newSlots[sourceIndex] = targetPlayer
        ? {
            ...targetPlayer,
            lineIndex: getLineNumber(sourceIndex) - 1,
            slotOrder: sourceIndex,
          }
        : null
    } else if (dragSource.type === "bench") {
      const p = dragSource.player
      for (let i = 0; i < newSlots.length; i++) {
        if (newSlots[i]?.playerId === p.id) {
          newSlots[i] = null
        }
      }
      newSlots[dropIndex] = {
        playerId: p.id,
        displayName: p.display_name ?? p.id,
        jerseyNumber: p.jersey_number,
        position: abbreviatePosition(p.position),
        lineIndex: getLineNumber(dropIndex) - 1,
        slotOrder: dropIndex,
      }
    }

    setDragSource(null)
    const playersClean = newSlots.filter((s): s is GameSheetPlayer => s !== null)
    saveData({ ...displayData, players: playersClean })
  }

  function handleDropOnLineHeader(e: React.DragEvent, lineNum: number, startSlotIdx: number, endSlotIdx: number) {
    e.preventDefault()
    if (!dragSource) return

    const newSlots = [...slots]
    let targetSlot = -1
    for (let i = startSlotIdx; i < endSlotIdx; i++) {
      if (newSlots[i] === null) {
        targetSlot = i
        break
      }
    }
    if (targetSlot === -1) targetSlot = startSlotIdx

    if (dragSource.type === "bench") {
      const p = dragSource.player
      for (let i = 0; i < newSlots.length; i++) {
        if (newSlots[i]?.playerId === p.id) newSlots[i] = null
      }
      newSlots[targetSlot] = {
        playerId: p.id,
        displayName: p.display_name ?? p.id,
        jerseyNumber: p.jersey_number,
        position: abbreviatePosition(p.position),
        lineIndex: lineNum - 1,
        slotOrder: targetSlot,
      }
    } else if (dragSource.type === "slot") {
      const sourceIndex = dragSource.index
      if (sourceIndex === targetSlot) return
      const sourcePlayer = newSlots[sourceIndex]
      const targetPlayer = newSlots[targetSlot]

      newSlots[targetSlot] = sourcePlayer
        ? {
            ...sourcePlayer,
            lineIndex: lineNum - 1,
            slotOrder: targetSlot,
          }
        : null

      newSlots[sourceIndex] = targetPlayer
        ? {
            ...targetPlayer,
            lineIndex: getLineNumber(sourceIndex) - 1,
            slotOrder: sourceIndex,
          }
        : null
    }

    setDragSource(null)
    const playersClean = newSlots.filter((s): s is GameSheetPlayer => s !== null)
    saveData({ ...displayData, players: playersClean })
  }

  function handleDragEnd() {
    setDragSource(null)
    setDragOverIndex(null)
  }

  function handlePositionChange(slotIndex: number, pos: string) {
    const newSlots = [...slots]
    const cur = newSlots[slotIndex]
    if (cur) {
      newSlots[slotIndex] = { ...cur, position: pos }
      const playersClean = newSlots.filter((s): s is GameSheetPlayer => s !== null)
      saveData({ ...displayData, players: playersClean })
    }
  }

  // ── Moveable Dividers ───────────────────────────────────────────────────

  function toggleDividerAt(rowNumber: number) {
    let nextDividers: number[]
    if (dividers.includes(rowNumber)) {
      nextDividers = dividers.filter((d) => d !== rowNumber)
    } else {
      nextDividers = [...dividers, rowNumber].sort((a, b) => a - b)
    }
    saveData({ ...displayData, lineDividers: nextDividers })
  }

  // ── Point Grid Interactions ─────────────────────────────────────────────

  function setLineOnField(linePlayerIds: string[], pointIndex: number) {
    triggerHaptic("medium")
    const pts = [...displayData.points]
    const point = { ...pts[pointIndex] }
    // Keep any players already on field from other lines, replace only this line's players
    const otherLineIds = point.playerIds.filter((id) => !linePlayerIds.includes(id))
    const activeLineIds = linePlayerIds.filter((id) => !data.injuredPlayerIds?.includes(id))
    point.playerIds = [...otherLineIds, ...activeLineIds]
    pts[pointIndex] = point
    saveData({ ...displayData, points: pts })
  }

  function togglePlayerPoint(playerId: string | undefined, pointIndex: number) {
    if (!playerId) return
    // If player is marked injured/out, ignore click
    if (data.injuredPlayerIds?.includes(playerId)) return

    const pts = [...displayData.points]
    const point = { ...pts[pointIndex] }
    const has = point.playerIds.includes(playerId)

    // When adding (not removing) and gender ratio is enabled, check FMP-as-MMP
    // For 4v4 startingRatio is unused, so fall back to "4fmp-3mmp" as a neutral key
    if (!has && data.genderRatioEnabled && (data.startingRatio || playersPerSide === 4)) {
      const ratioKey = (data.startingRatio ?? "4fmp-3mmp") as StartingRatio
      if (isFmpAsMmp(playerId, point.playerIds, pointIndex, ratioKey, teamPlayers, playersPerSide)) {
        setPendingFmpAsMmp({ playerId, pointIndex })
        return
      }
    }

    triggerHaptic("light")
    point.playerIds = has
      ? point.playerIds.filter((id) => id !== playerId)
      : [...point.playerIds, playerId]
    pts[pointIndex] = point
    saveData({ ...displayData, points: pts })
  }

  function confirmFmpAsMmp() {
    if (!pendingFmpAsMmp) return
    triggerHaptic("warning")
    const { playerId, pointIndex } = pendingFmpAsMmp
    const pts = [...displayData.points]
    const point = { ...pts[pointIndex] }
    point.playerIds = [...point.playerIds, playerId]
    pts[pointIndex] = point
    saveData({ ...displayData, points: pts })
    setPendingFmpAsMmp(null)
  }

  function toggleGenderRatio() {
    triggerHaptic("medium")
    saveData({ ...displayData, genderRatioEnabled: !displayData.genderRatioEnabled })
  }

  function setStartingRatio(ratio: StartingRatio) {
    triggerHaptic("light")
    saveData({ ...displayData, startingRatio: ratio })
  }

  function toggleCleanHold(pointIndex: number) {
    triggerHaptic("light")
    const pts = [...displayData.points]
    pts[pointIndex] = { ...pts[pointIndex], isCleanHold: !pts[pointIndex].isCleanHold }
    saveData({ ...displayData, points: pts })
  }

  function toggleCleanBreak(pointIndex: number) {
    triggerHaptic("light")
    const pts = [...displayData.points]
    pts[pointIndex] = { ...pts[pointIndex], isCleanBreak: !pts[pointIndex].isCleanBreak }
    saveData({ ...displayData, points: pts })
  }

  function resetPointPlayers(pointIndex: number) {
    triggerHaptic("warning")
    const pts = [...displayData.points]
    pts[pointIndex] = {
      ...pts[pointIndex],
      playerIds: [],
      isCleanHold: false,
      isCleanBreak: false,
    }
    saveData({ ...displayData, points: pts })
  }

  function toggleScorer(pointIndex: number, target: "us" | "them") {
    triggerHaptic("medium")
    const pts = [...displayData.points]
    const current = pts[pointIndex].scorer
    const next = current === target ? null : target

    // Auto-predict hold or break if scorer is updated
    let cleanHold = pts[pointIndex].isCleanHold
    let cleanBreak = pts[pointIndex].isCleanBreak

    if (next === "us") {
      // Derive possession
      const startPoss = displayData.startingPossession || "offense"
      let expectedPoss: "offense" | "defense" = startPoss
      if (pointIndex > 0) {
        const prev = pts[pointIndex - 1]
        if (prev.scorer === "us") expectedPoss = "defense"
        else if (prev.scorer === "them") expectedPoss = "offense"
      }

      if (expectedPoss === "offense" && !cleanBreak) {
        cleanHold = true
      } else if (expectedPoss === "defense" && !cleanHold) {
        cleanBreak = true
      }
    } else if (next === "them") {
      // When opponent scores, clear our hold/break flags unless manually toggled
      cleanHold = false
      cleanBreak = false
    }

    pts[pointIndex] = {
      ...pts[pointIndex],
      scorer: next,
      isCleanHold: cleanHold,
      isCleanBreak: cleanBreak,
    }
    saveData({ ...displayData, points: pts })
  }

  function togglePlayerInjured(playerId: string) {
    triggerHaptic("light")
    const currentInjured = data.injuredPlayerIds || []
    const isInjured = currentInjured.includes(playerId)
    const nextInjured = isInjured
      ? currentInjured.filter((id) => id !== playerId)
      : [...currentInjured, playerId]
    saveData({ ...displayData, injuredPlayerIds: nextInjured })
  }

  function toggleStartingPossession() {
    triggerHaptic("medium")
    const current = displayData.startingPossession || "offense"
    const next = current === "offense" ? "defense" : "offense"
    saveData({ ...displayData, startingPossession: next })
  }

  function toggleStartingEnd() {
    triggerHaptic("medium")
    const current = displayData.startingEnd
    const next = current === "left" ? "right" : current === "right" ? undefined : "left"
    saveData({ ...displayData, startingEnd: next })
  }

  // ── Auto-open stats panel when a point is scored for us ────────────────
  const currentPointScorer = displayData.points[selectedLivePoint]?.scorer
  useEffect(() => {
    if (gameMode && currentPointScorer === "us") {
      setIsStatsPanelOpen(true)
    }
  }, [gameMode, selectedLivePoint, currentPointScorer, displayData.points])

  // ── Stat mutation helpers ───────────────────────────────────────────────

  function setGoalScorer(pointIndex: number, playerId: string | null) {
    triggerHaptic("light")
    const pts = [...displayData.points]
    pts[pointIndex] = { ...pts[pointIndex], goalScorerId: playerId ?? undefined }
    saveData({ ...displayData, points: pts })
  }

  function setAssistPlayer(pointIndex: number, playerId: string | null) {
    triggerHaptic("light")
    const pts = [...displayData.points]
    pts[pointIndex] = { ...pts[pointIndex], assistPlayerId: playerId ?? undefined }
    saveData({ ...displayData, points: pts })
  }

  function adjustPlayerStat(
    pointIndex: number,
    playerId: string,
    stat: keyof PlayerPointStats,
    delta: 1 | -1
  ) {
    triggerHaptic("light")
    const pts = [...displayData.points]
    const existing = pts[pointIndex].playerStats ?? {}
    const current = existing[playerId] ?? { dBlocks: 0, throwaways: 0, drops: 0 }
    pts[pointIndex] = {
      ...pts[pointIndex],
      playerStats: {
        ...existing,
        [playerId]: { ...current, [stat]: Math.max(0, current[stat] + delta) },
      },
    }
    saveData({ ...displayData, points: pts })
  }

  function adjustOpponentBlocks(pointIndex: number, delta: 1 | -1) {
    triggerHaptic("light")
    const pts = [...displayData.points]
    const current = pts[pointIndex].opponentBlocks ?? 0
    pts[pointIndex] = { ...pts[pointIndex], opponentBlocks: Math.max(0, current + delta) }
    saveData({ ...displayData, points: pts })
  }

  function setPlayerNote(playerId: string, note: string) {
    const next = { ...displayData, playerNotes: { ...displayData.playerNotes, [playerId]: note } }
    saveData(next)
  }

  // Timeouts: 1st Half (0-2) and 2nd Half (0-2)
  const ourH1 = displayData.ourTimeoutsH1 ?? 0
  const ourH2 = displayData.ourTimeoutsH2 ?? 0
  const theirH1 = displayData.theirTimeoutsH1 ?? 0
  const theirH2 = displayData.theirTimeoutsH2 ?? 0

  function toggleHalfTimeout(side: "our" | "their", half: "h1" | "h2", index: number) {
    const key = side === "our"
      ? (half === "h1" ? "ourTimeoutsH1" : "ourTimeoutsH2")
      : (half === "h1" ? "theirTimeoutsH1" : "theirTimeoutsH2")
    const cur = displayData[key] ?? 0
    const next = cur === index + 1 ? index : index + 1
    saveData({ ...displayData, [key]: Math.max(0, Math.min(2, next)) })
  }

  // ── Derived Values ──────────────────────────────────────────────────────

  const assignedPlayerIds = new Set(slots.filter((s): s is GameSheetPlayer => s !== null).map((s) => s.playerId))
  const unassignedTeamPlayers = teamPlayers.filter((p) => !assignedPlayerIds.has(p.id))

  const startPoss = displayData.startingPossession || "offense"

  // Calculate holds and breaks for both Us (Ignite) and Them (Opponent)
  let ourHoldsCount = 0
  let ourBreaksCount = 0
  let theirHoldsCount = 0
  let theirBreaksCount = 0

  // Running scores and point outcome derivation
  let runningUs = 0
  let runningThem = 0
  const pointOutcomes = displayData.points.map((pt, idx) => {
    let expectedPoss: "offense" | "defense" = startPoss
    if (idx > 0) {
      const prev = displayData.points[idx - 1]
      if (prev.scorer === "us") expectedPoss = "defense"
      else if (prev.scorer === "them") expectedPoss = "offense"
    }

    let outcome: "us_hold" | "us_break" | "them_hold" | "them_break" | null = null

    if (pt.scorer === "us") {
      runningUs++
      if (pt.isCleanHold || (expectedPoss === "offense" && !pt.isCleanBreak)) {
        ourHoldsCount++
        outcome = "us_hold"
      } else {
        ourBreaksCount++
        outcome = "us_break"
      }
    } else if (pt.scorer === "them") {
      runningThem++
      if (expectedPoss === "defense") {
        theirHoldsCount++
        outcome = "them_hold"
      } else {
        theirBreaksCount++
        outcome = "them_break"
      }
    }

    return {
      pointNumber: pt.pointNumber,
      expectedPoss,
      outcome,
    }
  })

  const ourRunningScores = displayData.points.map((pt) => {
    return { isScored: pt.scorer === "us", total: 0 }
  })
  // Fill accurate running totals
  let rUs = 0
  displayData.points.forEach((pt, i) => {
    if (pt.scorer === "us") rUs++
    ourRunningScores[i] = { isScored: pt.scorer === "us", total: rUs }
  })

  const theirRunningScores = displayData.points.map((pt) => {
    return { isScored: pt.scorer === "them", total: 0 }
  })
  let rThem = 0
  displayData.points.forEach((pt, i) => {
    if (pt.scorer === "them") rThem++
    theirRunningScores[i] = { isScored: pt.scorer === "them", total: rThem }
  })

  const holds = ourHoldsCount
  const breaks = ourBreaksCount

  const totalOurScore = runningUs
  const totalTheirScore = runningThem

  // Points played per player sum
  function getPlayerPointsPlayed(playerId: string | undefined): number {
    if (!playerId) return 0
    return displayData.points.filter((pt) => pt.playerIds.includes(playerId)).length
  }

  const tournamentDate = ""  // no event-linked dates in standalone app

  // Filter sheets for switcher
  const filteredSheets = sheets.filter((s) => {
    if (sheetFilter === "active") return !s.sheet_data?.isArchived
    if (sheetFilter === "archived") return !!s.sheet_data?.isArchived
    return true
  })

  const currentLivePointObj = displayData.points[selectedLivePoint] || emptyPoint(selectedLivePoint + 1)

  return (
    <>
      <style>{`
        @media print {
          @page { size: landscape; margin: 0.35cm; }
          body { font-size: 6.5pt !important; background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          .sheet-scroll-container { overflow: visible !important; border: 1px solid #999 !important; }
          .sheet-table { table-layout: fixed; width: 100% !important; border-collapse: collapse !important; }
          .sheet-table th, .sheet-table td { padding: 0.5px 1.5px !important; font-size: 6.5pt !important; height: 13px !important; line-height: 13px !important; border-color: #bbb !important; }
          .roster-cell { height: 13px !important; line-height: 13px !important; }
          .point-cell { width: 13px !important; min-width: 13px !important; max-width: 13px !important; }
          .point-checkbox { width: 9px !important; height: 9px !important; }
          nav, header { display: none !important; }
          .sheet-header-print { display: flex !important; }
          .print-blank-cell { background: transparent !important; color: transparent !important; }
          .print-blank-box { width: 100% !important; height: 11px !important; border: 1px solid #777 !important; display: block !important; }
          .print-show-box { display: block !important; }
          .print-hide-val { display: none !important; }
          .paper-bottom-grid { display: grid !important; grid-template-columns: 2fr 1fr 2fr !important; gap: 4px !important; }
        }
        @media screen {
          .sheet-header-print { display: none; }
          .print-show-box { display: none; }
        }
      `}</style>

      <div className="space-y-4">
        {/* ── Top controls (Filter tabs, Sheet Picker, Actions) ─────── */}
        <div className="flex flex-wrap gap-2 items-center justify-between print:hidden border-b border-border pb-3">
          {/* Active vs Archived Filters */}
          <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => {
                setSheetFilter("active")
                const firstActive = sheets.find((s) => !s.sheet_data?.isArchived)
                if (firstActive && getSheet(selectedSheetId)?.sheet_data?.isArchived) {
                  switchSheet(firstActive.id)
                }
              }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                sheetFilter === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active Sheets ({sheets.filter((s) => !s.sheet_data?.isArchived).length})
            </button>
            <button
              type="button"
              onClick={() => {
                setSheetFilter("archived")
                const firstArchived = sheets.find((s) => s.sheet_data?.isArchived)
                if (firstArchived && !getSheet(selectedSheetId)?.sheet_data?.isArchived) {
                  switchSheet(firstArchived.id)
                }
              }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                sheetFilter === "archived" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Archived ({sheets.filter((s) => s.sheet_data?.isArchived).length})
            </button>
            <button
              type="button"
              onClick={() => setSheetFilter("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                sheetFilter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All ({sheets.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateBlank}
              disabled={createPending}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-border text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {createPending ? "Creating…" : "+ New Blank Sheet"}
            </button>
          </div>
        </div>

        {/* ── Active Sheet Selection Bar ── */}
        <div className="flex flex-wrap gap-2 items-center print:hidden">
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <span className="text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Sheet:</span>
            {filteredSheets.length > 0 ? (
              <select
                value={selectedSheetId || (filteredSheets[0]?.id ?? "")}
                onChange={(e) => switchSheet(e.target.value)}
                className="flex-1 border border-input rounded-md px-2.5 py-1.5 text-sm bg-background text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {filteredSheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sheet_data?.isArchived ? "🔒 [Archived] " : ""}{sheetLabel(s)}
                  </option>
                ))}
              </select>
            ) : sheets.length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground italic">No sheets in {sheetFilter} tab.</span>
                <button
                  type="button"
                  onClick={() => {
                    setSheetFilter("all")
                    switchSheet(sheets[0].id)
                  }}
                  className="text-xs text-primary underline"
                >
                  View all sheets
                </button>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground italic">No sheets yet — create one below.</span>
            )}
          </div>

          {selectedSheetId && activeSheet && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setTemplateName(`${sheetLabel(activeSheet)} (Copy)`)
                  setShowTemplateModal(true)
                }}
                disabled={clonePending}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Duplicate roster and line setup into a new fresh game sheet"
              >
                📑 Use as Template
              </button>

              <button
                type="button"
                onClick={toggleArchiveStatus}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  isArchived
                    ? "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 hover:bg-amber-200"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={isArchived ? "Unarchive and reopen for editing" : "Archive and lock for history"}
              >
                {isArchived ? "🔒 Archived" : "📥 Archive Sheet"}
              </button>

              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deletePending}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                title="Delete this game sheet"
              >
                🗑
              </button>
            </div>
          )}
        </div>

        {/* Template Modal */}
        {showTemplateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
            <div className="bg-card border border-border rounded-lg max-w-sm w-full p-4 space-y-3 shadow-xl">
              <h3 className="font-bold text-foreground text-sm">Duplicate as Template</h3>
              <p className="text-xs text-muted-foreground">
                This copies the 24-slot roster order and line dividers to a new fresh game sheet with scores and points reset.
              </p>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="New Sheet Title"
                className="w-full text-xs p-2 rounded border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDuplicateAsTemplate}
                  disabled={clonePending}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {clonePending ? "Creating…" : "Create Copy"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
            <div className="bg-card border border-border rounded-lg max-w-sm w-full p-4 space-y-4 shadow-xl">
              <div>
                <h3 className="font-bold text-foreground text-base">Delete Game Sheet?</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Are you sure you want to delete <strong className="text-foreground">{activeSheet ? sheetLabel(activeSheet) : "this sheet"}</strong>? This action cannot be undone.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deletePending}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-accent text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSheet}
                  disabled={deletePending}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deletePending ? "Deleting…" : "Yes, Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {saveError && (
          <p className="text-sm text-destructive print:hidden">{saveError}</p>
        )}

        {selectedSheetId && activeSheet ? (
          <>
            {/* ── Archived Read-Only Banner ── */}
            {isArchived && (
              <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 flex flex-wrap items-center justify-between gap-2 text-xs print:hidden shadow-sm">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                  <span className="text-sm">🔒</span>
                  <span className="font-semibold">
                    {isReadOnly
                      ? "This game sheet is archived and in read-only mode."
                      : "Editing unlocked for this archived sheet."}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isReadOnly ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingArchived(true)}
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors"
                    >
                      ✏ Enable Editing
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditingArchived(false)}
                      className="px-2.5 py-1 rounded border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 font-medium transition-colors"
                    >
                      🔒 Lock Again
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Metadata & Configuration Bar + Live Mode Button ──────── */}
            <div className="flex gap-3 items-stretch print:hidden">

              {/* Metadata panel */}
              <div className="flex flex-wrap gap-3 items-end p-3 rounded-lg border border-border bg-card flex-1 min-w-0">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Sheet Title / Label</label>
                <input
                  type="text"
                  value={sheetTitle}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    setSheetTitle(e.target.value)
                    const next = { ...displayData, customTitle: e.target.value }
                    setData(next)
                    save({ sheet_data: next })
                  }}
                  placeholder="e.g. Finals vs Furious"
                  className="border border-input rounded-md px-2 py-1.5 text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-44 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>


              {/* Tournament Name */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Tournament</label>
                <input
                  type="text"
                  value={tournamentName}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    const val = e.target.value
                    setTournamentName(val)
                    setSheets((prev) =>
                      prev.map((s) => s.id === selectedSheetId ? { ...s, tournament_name: val } : s)
                    )
                    save({ tournament_name: val })
                  }}
                  placeholder="e.g. Winter League"
                  className="border border-input rounded-md px-2 py-1.5 text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-40 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Opponent</label>
                <input
                  type="text"
                  value={opponentName}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    const val = e.target.value
                    setOpponentName(val)
                    setSheets((prev) =>
                      prev.map((s) => s.id === selectedSheetId ? { ...s, opponent_name: val } : s)
                    )
                    save({ opponent_name: val })
                  }}
                  placeholder="e.g. Rival Club"
                  className="border border-input rounded-md px-2 py-1.5 text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-36 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Field</label>
                <input
                  type="text"
                  value={fieldName}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    const val = e.target.value
                    setFieldName(val)
                    save({ field: val })
                  }}
                  placeholder="e.g. Field 4"
                  className="border border-input rounded-md px-2 py-1.5 text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-28 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">
                  Points: <span className="font-bold text-foreground">{activePoints}</span>
                </label>
                <input
                  type="range"
                  min={minPoints}
                  max={maxPoints}
                  value={activePoints}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setActivePoints(n)
                    saveData({ ...data, totalPoints: n })
                  }}
                  className="w-20 accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowDividerControls((v) => !v)}
                  disabled={isReadOnly}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    showDividerControls ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                  title="Configure line dividers"
                >
                  ✂ Line Splits
                </button>
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => setShowPresetManager((v) => !v)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    showPresetManager ? "bg-amber-500/10 border-amber-500 text-amber-700 dark:text-amber-300" : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                  title="Manage named line presets (Power O, Power D, etc.)"
                >
                  ⚡ Presets ({(data.linePresets ?? []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowRosterBench((v) => !v)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    showRosterBench ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  👥 Bench ({unassignedTeamPlayers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowSummaryModal(true)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary transition-colors shadow-sm"
                  title="View post-game player points, holds, and break breakdown"
                >
                  📊 Summary & Stats
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                >
                  🖨 Print
                </button>
              </div>
              </div>{/* end metadata panel */}

              {/* Live Mode square button — own panel */}
              <button
                type="button"
                onClick={() => {
                  const entering = !gameMode
                  if (entering) {
                    setGridWasCollapsedBeforeLive(isGridCollapsed)
                    setIsGridCollapsed(true)
                  } else {
                    setIsGridCollapsed(gridWasCollapsedBeforeLive)
                  }
                  setGameMode(entering)
                }}
                className={`aspect-square w-24 shrink-0 rounded-lg border-2 font-bold transition-all shadow-sm flex flex-col items-center justify-center gap-1.5 ${
                  gameMode
                    ? "bg-amber-600 border-amber-500 text-white hover:bg-amber-700 ring-2 ring-amber-400"
                    : "bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700"
                }`}
              >
                <span className="text-2xl leading-none">{gameMode ? "📋" : "⚡"}</span>
                <span className="text-xs font-bold leading-tight text-center px-1">{gameMode ? "Exit Live" : "Live Mode"}</span>
              </button>
            </div>

            {/* Offline Sync Status Banner & Precache */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 print:hidden">
              <SyncStatusBadge
                onPrecache={handlePrecacheTournament}
                isPrecaching={isPrecaching}
              />

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Initial Pull/Start:</span>
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={toggleStartingPossession}
                  className={`px-2.5 py-1 rounded text-xs font-bold uppercase transition-all disabled:opacity-50 ${
                    (displayData.startingPossession || "offense") === "offense"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-blue-600 text-white shadow-sm"
                  }`}
                  title="Click to toggle starting on Offense or Defense"
                >
                  {(displayData.startingPossession || "offense") === "offense" ? "Start On Offense (O)" : "Start On Defense (D)"}
                </button>
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={toggleStartingEnd}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5 ${
                    displayData.startingEnd === "left"
                      ? "bg-violet-600 text-white shadow-sm"
                      : displayData.startingEnd === "right"
                      ? "bg-orange-600 text-white shadow-sm"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                  title="Click to set which end the team started at (cycles: Left → Right → unset)"
                >
                  {displayData.startingEnd === "left" ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                      <span>Started</span>
                    </>
                  ) : displayData.startingEnd === "right" ? (
                    <>
                      <span>Started</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="9 5 3 12 9 19"/><polyline points="15 5 21 12 15 19"/></svg>
                      <span>End</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={toggleGenderRatio}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all disabled:opacity-50 ${
                    displayData.genderRatioEnabled
                      ? "bg-pink-600 text-white shadow-sm"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                  title={playersPerSide === 4 ? "Toggle gender ratio enforcement (2F/2M)" : "Toggle gender ratio enforcement (FMP/MMP alternating)"}
                >
                  ⚥ Ratio {displayData.genderRatioEnabled ? "On" : "Off"}
                </button>
                {displayData.genderRatioEnabled && playersPerSide === 7 && (
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => setStartingRatio(
                      (displayData.startingRatio ?? "4fmp-3mmp") === "4fmp-3mmp" ? "3fmp-4mmp" : "4fmp-3mmp"
                    )}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all disabled:opacity-50 ${
                      (displayData.startingRatio ?? "4fmp-3mmp") === "4fmp-3mmp"
                        ? "bg-pink-500 text-white shadow-sm"
                        : "bg-blue-500 text-white shadow-sm"
                    }`}
                    title="Click to toggle starting gender ratio"
                  >
                    {(displayData.startingRatio ?? "4fmp-3mmp") === "4fmp-3mmp" ? "Start 4F/3M" : "Start 3F/4M"}
                  </button>
                )}
              </div>
            </div>

            {/* ── LIVE SIDELINE "GAME MODE" (Tablet & Mobile Optimized) ── */}
            {gameMode && (
              <div className="p-4 rounded-xl border-2 border-emerald-500 bg-emerald-500/5 print:hidden space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setIsGameModeCollapsed((c) => !c)}
                      className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-600 text-white flex items-center gap-1.5 hover:bg-emerald-700 transition-colors shadow-sm"
                      title={isGameModeCollapsed ? "Expand Sideline Game Mode" : "Collapse Sideline Game Mode"}
                    >
                      <span>{isGameModeCollapsed ? "▶" : "▼"}</span>
                      <span>Sideline Live Mode</span>
                    </button>
                    <span className="font-bold text-base sm:text-lg text-foreground">
                      {teamName} <span className="text-emerald-600">{totalOurScore}</span> — <span className="text-rose-600">{totalTheirScore}</span> {opponentName || "Opponent"}
                    </span>
                  </div>

                  {/* Quick Scorer Buttons & Controls */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => !isReadOnly && toggleScorer(selectedLivePoint, "us")}
                      className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        currentLivePointObj.scorer === "us"
                          ? "bg-amber-600 text-white ring-2 ring-amber-400"
                          : "bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
                      }`}
                    >
                      +1 {teamName} (Pt {selectedLivePoint + 1})
                    </button>
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => !isReadOnly && toggleScorer(selectedLivePoint, "them")}
                      className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        currentLivePointObj.scorer === "them"
                          ? "bg-rose-600 text-white ring-2 ring-rose-400"
                          : "bg-rose-500/20 text-rose-800 dark:text-rose-300 hover:bg-rose-500/30 border border-rose-500/40"
                      }`}
                    >
                      +1 Opponent
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsGameModeCollapsed((c) => !c)}
                      className="p-1.5 text-xs rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      title={isGameModeCollapsed ? "Expand Game Mode panel" : "Collapse Game Mode panel"}
                    >
                      {isGameModeCollapsed ? "Expand ↕" : "Collapse ↕"}
                    </button>
                  </div>
                </div>

                {!isGameModeCollapsed && (
                  <div className="space-y-3 pt-1">
                    {/* Point Selector Strip */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                      {displayData.points.map((pt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedLivePoint(idx)}
                          className={`px-3 py-2 min-h-[40px] rounded-md text-xs font-bold transition-all shrink-0 border ${
                            selectedLivePoint === idx
                              ? "bg-primary text-primary-foreground border-primary ring-2 ring-primary/40"
                              : pt.scorer === "us"
                              ? "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-400"
                              : pt.scorer === "them"
                              ? "bg-rose-500/20 text-rose-800 dark:text-rose-300 border-rose-400"
                              : "bg-card text-muted-foreground border-border hover:bg-accent"
                          }`}
                        >
                          Pt {pt.pointNumber}
                          {pt.scorer === "us" && " 🟢"}
                          {pt.scorer === "them" && " 🔴"}
                        </button>
                      ))}
                    </div>

                    {/* Point Sub Header: Count, Reset & Hold/Break */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-y border-border/60 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">
                          Point {selectedLivePoint + 1} Lineup:
                        </span>
                        <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${
                          currentLivePointObj.playerIds.length === playersPerSide
                            ? "bg-emerald-600 text-white"
                            : currentLivePointObj.playerIds.length > playersPerSide
                            ? "bg-rose-600 text-white"
                            : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                        }`}>
                          {currentLivePointObj.playerIds.length} / {playersPerSide} on field
                        </span>
                        {displayData.genderRatioEnabled && (displayData.startingRatio || playersPerSide === 4) && (() => {
                          const ratioKey = (displayData.startingRatio ?? "4fmp-3mmp") as StartingRatio
                          const status = getRatioStatus(selectedLivePoint, ratioKey, currentLivePointObj.playerIds, teamPlayers, playersPerSide)
                          const expected = getExpectedRatio(selectedLivePoint, ratioKey, playersPerSide)
                          const { fmp, mmp } = countGenders(currentLivePointObj.playerIds, teamPlayers)
                          return (
                            <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${
                              status === "ok" ? "bg-pink-600 text-white" : status === "wrong" ? "bg-orange-500 text-white" : "bg-muted text-muted-foreground"
                            }`} title={`Expected: ${expected.fmp}F / ${expected.mmp}M`}>
                              {status === "incomplete" ? `${expected.fmp}F/${expected.mmp}M` : `${fmp}F ${mmp}M${status === "ok" ? " ✓" : " ⚠"}`}
                            </span>
                          )
                        })()}
                        {currentLivePointObj.playerIds.length > 0 && (
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => !isReadOnly && resetPointPlayers(selectedLivePoint)}
                            className="px-2 py-0.5 rounded text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Clear all selected players for this point"
                          >
                            ↺ Reset Lineup
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Auto-detected Point Outcome Badge */}
                        {pointOutcomes[selectedLivePoint]?.outcome && (
                          <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                            pointOutcomes[selectedLivePoint].outcome === "us_hold"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                              : pointOutcomes[selectedLivePoint].outcome === "us_break"
                              ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                              : pointOutcomes[selectedLivePoint].outcome === "them_hold"
                              ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                              : "bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30"
                          }`}>
                            {pointOutcomes[selectedLivePoint].outcome === "us_hold" && `${teamName} Hold`}
                            {pointOutcomes[selectedLivePoint].outcome === "us_break" && `${teamName} Break`}
                            {pointOutcomes[selectedLivePoint].outcome === "them_hold" && `${opponentName || "Opp"} Hold`}
                            {pointOutcomes[selectedLivePoint].outcome === "them_break" && `${opponentName || "Opp"} Break`}
                          </span>
                        )}

                        <label className={`flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400 ${isReadOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`} title={`Toggle ${teamName} Hold override`}>
                          <input
                            type="checkbox"
                            checked={currentLivePointObj.isCleanHold}
                            disabled={isReadOnly}
                            onChange={() => !isReadOnly && toggleCleanHold(selectedLivePoint)}
                            className="w-4 h-4 rounded accent-emerald-600"
                          />
                          Hold (Us)
                        </label>
                        <label className={`flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-400 ${isReadOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`} title={`Toggle ${teamName} Break override`}>
                          <input
                            type="checkbox"
                            checked={currentLivePointObj.isCleanBreak}
                            disabled={isReadOnly}
                            onChange={() => !isReadOnly && toggleCleanBreak(selectedLivePoint)}
                            className="w-4 h-4 rounded accent-blue-600"
                          />
                          Break (Us)
                        </label>
                      </div>
                    </div>

                    {/* ── FMP-as-MMP Confirmation ── */}
                    {pendingFmpAsMmp && pendingFmpAsMmp.pointIndex === selectedLivePoint && (() => {
                      const player = teamPlayers.find(p => p.id === pendingFmpAsMmp.playerId)
                      const ratioKey = (displayData.startingRatio ?? "4fmp-3mmp") as StartingRatio
                      const expected = getExpectedRatio(selectedLivePoint, ratioKey, playersPerSide)
                      return (
                        <div className="rounded-lg border-2 border-orange-400 bg-orange-50 dark:bg-orange-950/20 p-3 space-y-2">
                          <div className="text-xs font-bold text-orange-700 dark:text-orange-300">
                            ⚠️ FMP playing as MMP-matching
                          </div>
                          <div className="text-xs text-foreground">
                            <span className="font-semibold">{player?.display_name ?? "This player"}</span> is FMP but this point calls for {expected ? `${expected.fmp}F/${expected.mmp}M` : "more MMP"}. The FMP quota is already full.
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={confirmFmpAsMmp}
                              className="px-3 py-1.5 rounded-md text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                            >
                              Confirm — Add as MMP-matching
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingFmpAsMmp(null)}
                              className="px-3 py-1.5 rounded-md text-xs font-bold border border-border text-muted-foreground hover:bg-accent transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )
                    })()}

                    {/* ── Preset Quick-Select ── */}
                    {(data.linePresets ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">⚡ Presets</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(data.linePresets ?? []).map((preset) => {
                            const activeIds = new Set(currentLivePointObj.playerIds)
                            const presetIds = new Set(preset.playerIds)
                            const isActive = presetIds.size === activeIds.size && preset.playerIds.every((id) => activeIds.has(id))
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                disabled={isReadOnly}
                                onClick={() => !isReadOnly && preset.playerIds.length > 0 && setLineOnField(preset.playerIds.slice(0, 7), selectedLivePoint)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                  isActive
                                    ? "bg-amber-600 text-white border-amber-500 ring-2 ring-amber-400"
                                    : "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/20"
                                }`}
                              >
                                {preset.name}
                                <span className="ml-1.5 opacity-70 font-normal">({preset.playerIds.length})</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Color-coded and grouped players by Line */}
                    <div className="space-y-3">
                      {Array.from({ length: sortedDividers.length + 1 }, (_, lineIdx) => {
                        const lineNum = lineIdx + 1
                        const startIdx = lineIdx === 0 ? 0 : sortedDividers[lineIdx - 1]
                        const endIdx = lineIdx < sortedDividers.length ? sortedDividers[lineIdx] : totalSlots
                        const lineSlots = slots
                          .map((player, slotIndex) => ({ player, slotIndex }))
                          .slice(startIdx, endIdx)
                          .filter((item): item is { player: GameSheetPlayer; slotIndex: number } => item.player !== null)

                        if (lineSlots.length === 0) return null

                        // Distinct color schemes for each line
                        const lineColors = [
                          {
                            badge: "bg-blue-600 text-white",
                            activeBorder: "border-blue-500 ring-2 ring-blue-400 bg-blue-600 text-white shadow-md",
                            inactiveBg: "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 text-foreground",
                            tag: "border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300",
                          },
                          {
                            badge: "bg-emerald-600 text-white",
                            activeBorder: "border-emerald-500 ring-2 ring-emerald-400 bg-emerald-600 text-white shadow-md",
                            inactiveBg: "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 text-foreground",
                            tag: "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300",
                          },
                          {
                            badge: "bg-purple-600 text-white",
                            activeBorder: "border-purple-500 ring-2 ring-purple-400 bg-purple-600 text-white shadow-md",
                            inactiveBg: "bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/40 hover:bg-purple-100/60 dark:hover:bg-purple-900/40 text-foreground",
                            tag: "border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300",
                          },
                          {
                            badge: "bg-amber-600 text-white",
                            activeBorder: "border-amber-500 ring-2 ring-amber-400 bg-amber-600 text-white shadow-md",
                            inactiveBg: "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 text-foreground",
                            tag: "border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300",
                          },
                        ]

                        const colorTheme = lineColors[(lineNum - 1) % lineColors.length]
                        const customDividerName = data.lineDividers ? undefined : undefined // or default
                        const lineTitle = `Line ${lineNum}`

                        return (
                          <div key={lineNum} className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={isReadOnly}
                                onClick={() => !isReadOnly && setLineOnField(lineSlots.map(s => s.player.playerId), selectedLivePoint)}
                                className={`text-xs font-bold uppercase px-3 py-1.5 min-h-[36px] rounded ${colorTheme.badge} disabled:opacity-50 hover:opacity-80 active:scale-95 transition-all`}
                                title={`Set all ${lineTitle} players on field`}
                              >
                                {lineTitle}
                              </button>
                              <span className="text-xs text-muted-foreground">
                                ({lineSlots.filter(s => currentLivePointObj.playerIds.includes(s.player.playerId)).length} on field)
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                              {lineSlots.map(({ player, slotIndex }) => {
                                const isPlaying = currentLivePointObj.playerIds.includes(player.playerId)
                                const playerPointsCount = getPlayerPointsPlayed(player.playerId)
                                const isInjured = Boolean(data.injuredPlayerIds?.includes(player.playerId))
                                const hasNote = Boolean(displayData.playerNotes?.[player.playerId]?.trim())

                                return (
                                  <div
                                    key={player.playerId}
                                    className={`p-2 rounded-lg border text-left flex items-center justify-between transition-all relative ${
                                      isInjured
                                        ? "opacity-60 bg-rose-500/10 border-rose-400 dark:border-rose-900/60"
                                        : isReadOnly
                                        ? "cursor-not-allowed "
                                        : isPlaying
                                        ? colorTheme.activeBorder
                                        : colorTheme.inactiveBg
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      disabled={isReadOnly || isInjured}
                                      onClick={() => !isReadOnly && !isInjured && togglePlayerPoint(player.playerId, selectedLivePoint)}
                                      className="flex-1 truncate pr-1 text-left disabled:cursor-not-allowed"
                                    >
                                      {(() => { const rp = teamPlayers.find(p => p.id === player.playerId); return rp?.gender === "FMP" ? <span className="inline-block w-2 h-2 rounded-full bg-pink-500 mr-1 shrink-0" /> : rp?.gender === "MMP" ? <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1 shrink-0" /> : null })()}
                                       <span className={`text-sm font-semibold ${isInjured ? "line-through text-muted-foreground" : ""}`}>
                                         {player.displayName}
                                       </span>
                                    </button>

                                    <div className="flex items-center gap-1">
                                      {/* Note indicator */}
                                      {hasNote && (
                                        <span
                                          title={displayData.playerNotes![player.playerId]}
                                          className="text-xs leading-none"
                                        >
                                          📝
                                        </span>
                                      )}

                                      {/* Injury toggle */}
                                      <button
                                        type="button"
                                        disabled={isReadOnly}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          togglePlayerInjured(player.playerId)
                                        }}
                                        title={isInjured ? "Player is out/injured. Click to reactivate" : "Click to mark player out/injured"}
                                        className={`px-2 py-1 min-h-[32px] text-xs rounded font-bold transition-transform hover:scale-105 ${
                                          isInjured
                                            ? "bg-rose-600 text-white shadow-sm"
                                            : "bg-background/80 hover:bg-rose-500/20 text-muted-foreground hover:text-rose-600 border border-border/50"
                                        }`}
                                      >
                                        {isInjured ? "⛔" : "⚠️"}
                                      </button>

                                      <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
                                        isPlaying
                                          ? "bg-white/25 text-white"
                                          : "bg-background/80 text-muted-foreground border border-border/50"
                                      }`}>
                                        {playerPointsCount} pts
                                      </span>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── STATS PANEL (below Game Mode, collapsible) ── */}
            {gameMode && !isReadOnly && (
              <div className="rounded-xl border-2 border-violet-500 bg-violet-500/5 print:hidden">
                {/* Header toggle bar — matches roster grid pattern */}
                <button
                  type="button"
                  onClick={() => setIsStatsPanelOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-2 rounded-t-xl hover:bg-violet-500/10 transition-colors text-sm font-semibold text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <span>{isStatsPanelOpen ? "▼" : "▶"}</span>
                    <span>📊 Stats — Pt {selectedLivePoint + 1}</span>
                    {!isStatsPanelOpen && (
                      <span className="text-xs font-normal text-muted-foreground">
                        goals, assists, blocks &amp; turnovers
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {isStatsPanelOpen ? "Hide" : "Show"}
                  </span>
                </button>

                {isStatsPanelOpen && (
                  <div className="px-4 pb-4 pt-1 space-y-4 border-t border-violet-500/30">

                    {/* ── Score buttons (duplicated from game mode header) ── */}
                    <div className="flex items-center gap-2 pt-1 justify-end">
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => !isReadOnly && toggleScorer(selectedLivePoint, "us")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                          currentLivePointObj.scorer === "us"
                            ? "bg-amber-600 text-white ring-2 ring-amber-400"
                            : "bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
                        }`}
                      >
                        +1 {teamName} (Pt {selectedLivePoint + 1})
                      </button>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => !isReadOnly && toggleScorer(selectedLivePoint, "them")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                          currentLivePointObj.scorer === "them"
                            ? "bg-rose-600 text-white ring-2 ring-rose-400"
                            : "bg-rose-500/20 text-rose-800 dark:text-rose-300 hover:bg-rose-500/30 border border-rose-500/40"
                        }`}
                      >
                        +1 Opponent
                      </button>
                    </div>

                    {/* ── Goal / Assist Card — only when we scored ── */}
                    {currentLivePointObj.scorer === "us" && (
                      <div className="rounded-lg border border-amber-400/60 bg-amber-500/10 p-3 space-y-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          🏆 Goal Scorer &amp; Assist — Pt {selectedLivePoint + 1}
                        </div>

                        {/* Goal scorer */}
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-foreground">
                            Goal Scorer <span className="text-rose-500">*</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {currentLivePointObj.playerIds.length === 0 ? (
                              <span className="text-xs text-muted-foreground italic">No players selected for this point</span>
                            ) : (
                              currentLivePointObj.playerIds.map((pid) => {
                                const p = displayData.players.find((pl) => pl.playerId === pid)
                                if (!p) return null
                                const isSelected = currentLivePointObj.goalScorerId === pid
                                return (
                                  <button
                                    key={pid}
                                    type="button"
                                    onClick={() => setGoalScorer(selectedLivePoint, isSelected ? null : pid)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                                      isSelected
                                        ? "bg-amber-600 text-white border-amber-500 ring-2 ring-amber-400"
                                        : "bg-card border-border text-foreground hover:bg-amber-500/20 hover:border-amber-400"
                                    }`}
                                  >
                                    {p.displayName}
                                  </button>
                                )
                              })
                            )}
                          </div>
                        </div>

                        {/* Assist */}
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-foreground">Assist (optional)</div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => setAssistPlayer(selectedLivePoint, null)}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                                !currentLivePointObj.assistPlayerId
                                  ? "bg-muted text-muted-foreground border-border ring-2 ring-muted"
                                  : "bg-card border-border text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              None
                            </button>
                            {currentLivePointObj.playerIds
                              .filter((pid) => pid !== currentLivePointObj.goalScorerId)
                              .map((pid) => {
                                const p = displayData.players.find((pl) => pl.playerId === pid)
                                if (!p) return null
                                const isSelected = currentLivePointObj.assistPlayerId === pid
                                return (
                                  <button
                                    key={pid}
                                    type="button"
                                    onClick={() => setAssistPlayer(selectedLivePoint, isSelected ? null : pid)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                                      isSelected
                                        ? "bg-violet-600 text-white border-violet-500 ring-2 ring-violet-400"
                                        : "bg-card border-border text-foreground hover:bg-violet-500/20 hover:border-violet-400"
                                    }`}
                                  >
                                    {p.displayName}
                                  </button>
                                )
                              })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Live stat counters per on-field player ── */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                        Player Stats — Pt {selectedLivePoint + 1}
                      </div>

                      {/* Column headers */}
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        <span>Player</span>
                        <span className="w-20 text-center text-blue-600 dark:text-blue-400">D-Block</span>
                        <span className="w-20 text-center text-amber-600 dark:text-amber-400">T/A</span>
                        <span className="w-20 text-center text-rose-600 dark:text-rose-400">Drop</span>
                        <span className="w-12 text-center pl-2">Note</span>
                      </div>

                      {currentLivePointObj.playerIds.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic px-1">Select players on field above to record stats</p>
                      ) : (
                        currentLivePointObj.playerIds.map((pid) => {
                          const p = displayData.players.find((pl) => pl.playerId === pid)
                          if (!p) return null
                          const pStats = currentLivePointObj.playerStats?.[pid] ?? { dBlocks: 0, throwaways: 0, drops: 0 }
                          const note = displayData.playerNotes?.[pid] ?? ""
                          const isNoteOpen = notePopupPlayerId === pid
                          return (
                            <div key={pid} className="relative bg-card border border-border rounded-lg px-2 py-1.5">
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center">
                                <span className="text-xs font-medium truncate">
                                  {p.displayName}
                                </span>
                                {(["dBlocks", "throwaways", "drops"] as (keyof PlayerPointStats)[]).map((stat, si) => {
                                  const colors = [
                                    "border-blue-400 text-blue-700 dark:text-blue-300",
                                    "border-amber-400 text-amber-700 dark:text-amber-300",
                                    "border-rose-400 text-rose-700 dark:text-rose-300",
                                  ]
                                  const addColors = [
                                    "bg-blue-500/10 hover:bg-blue-500/25 text-blue-700 dark:text-blue-300 border-blue-400",
                                    "bg-amber-500/10 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border-amber-400",
                                    "bg-rose-500/10 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 border-rose-400",
                                  ]
                                  return (
                                    <div key={stat} className="flex items-center gap-1 w-20 justify-center">
                                      <button
                                        type="button"
                                        onClick={() => adjustPlayerStat(selectedLivePoint, pid, stat, -1)}
                                        disabled={pStats[stat] === 0}
                                        className={`w-8 h-8 rounded text-sm font-bold border flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed ${colors[si]} bg-transparent hover:bg-black/5`}
                                      >
                                        −
                                      </button>
                                      <span className={`w-6 text-center text-sm font-bold ${colors[si]}`}>{pStats[stat]}</span>
                                      <button
                                        type="button"
                                        onClick={() => adjustPlayerStat(selectedLivePoint, pid, stat, 1)}
                                        className={`w-8 h-8 rounded text-sm font-bold border flex items-center justify-center ${addColors[si]}`}
                                      >
                                        +
                                      </button>
                                    </div>
                                  )
                                })}
                                {/* Note icon button */}
                                <div className="w-12 flex justify-center pl-2">
                                  <button
                                    type="button"
                                    onClick={() => setNotePopupPlayerId(isNoteOpen ? null : pid)}
                                    title={note ? `Note: ${note}` : "Add coaching note"}
                                    className={`w-8 h-8 rounded flex items-center justify-center text-base border transition-colors ${
                                      note
                                        ? "border-violet-400 bg-violet-500/15 text-violet-700 dark:text-violet-300"
                                        : "border-border text-muted-foreground hover:border-violet-400 hover:bg-violet-500/10 hover:text-violet-600"
                                    }`}
                                  >
                                    📝
                                  </button>
                                </div>
                              </div>

                              {/* Inline note popup */}
                              {isNoteOpen && (
                                <div className="mt-1.5 rounded-md border border-violet-400/60 bg-violet-500/5 p-2 space-y-1.5">
                                  <textarea
                                    value={note}
                                    onChange={(e) => setPlayerNote(pid, e.target.value)}
                                    placeholder={`Coaching note for ${p.displayName}…`}
                                    rows={3}
                                    autoFocus
                                    className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
                                  />
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => setNotePopupPlayerId(null)}
                                      className="px-2.5 py-1 text-xs font-medium rounded bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                                    >
                                      Done
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>

                    {/* ── Opponent Blocks Against (team-level) ── */}
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2">
                      <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                        They Got a D (Pt {selectedLivePoint + 1})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => adjustOpponentBlocks(selectedLivePoint, -1)}
                          disabled={(currentLivePointObj.opponentBlocks ?? 0) === 0}
                          className="w-9 h-9 rounded border border-rose-400 text-rose-700 dark:text-rose-300 text-base font-bold flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-rose-500/20"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-base font-bold text-rose-700 dark:text-rose-300">
                          {currentLivePointObj.opponentBlocks ?? 0}
                        </span>
                        <button
                          type="button"
                          onClick={() => adjustOpponentBlocks(selectedLivePoint, 1)}
                          className="w-9 h-9 rounded border border-rose-400 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-base font-bold flex items-center justify-center hover:bg-rose-500/25"
                        >
                          +
                        </button>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* ── Player Bench / Available Roster ──── */}
            {showRosterBench && !gameMode && (
              <div className="p-3 rounded-lg border border-border bg-muted/20 print:hidden space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      Available Players:
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      (Drag to row/line, or click to add to:
                    </span>
                    <div className="inline-flex rounded border border-border bg-background p-0.5 text-xs">
                      {Array.from({ length: sortedDividers.length + 1 }, (_, i) => i + 1).map((lineNum) => (
                        <button
                          key={lineNum}
                          type="button"
                          onClick={() => setSelectedTargetLine(lineNum)}
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                            selectedTargetLine === lineNum
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Line {lineNum}
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground">)</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {teamPlayers.length} players ({unassignedTeamPlayers.length} unassigned) · coaches excluded
                  </span>
                </div>

                {teamPlayers.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No players found in roster. Add players in Team settings.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {teamPlayers.map((p) => {
                      const isPlaced = assignedPlayerIds.has(p.id)
                      return (
                        <div
                          key={p.id}
                          draggable={!isReadOnly}
                          onDragStart={(e) => !isReadOnly && handleDragStartFromBench(e, p)}
                          onDragEnd={handleDragEnd}
                          onClick={() => {
                            if (isReadOnly) return
                            if (!isPlaced) {
                              const startIdx = selectedTargetLine === 1 ? 0 : (sortedDividers[selectedTargetLine - 2] ?? 0)
                              const endIdx = selectedTargetLine - 1 < sortedDividers.length ? sortedDividers[selectedTargetLine - 1] : totalSlots

                              let targetSlot = -1
                              for (let i = startIdx; i < endIdx; i++) {
                                if (slots[i] === null) {
                                  targetSlot = i
                                  break
                                }
                              }
                              if (targetSlot === -1) {
                                targetSlot = slots.findIndex((s) => s === null)
                              }

                              if (targetSlot !== -1) {
                                handleAssignPlayerToSlot(targetSlot, p)
                              }
                            }
                          }}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                            isReadOnly
                              ? "cursor-not-allowed opacity-50 bg-muted/20 border-border"
                              : "cursor-grab active:cursor-grabbing " +
                                (isPlaced
                                  ? "bg-muted/40 text-muted-foreground border-border/40 opacity-60"
                                  : "bg-background text-foreground border-border hover:border-primary hover:bg-primary/5 shadow-sm")
                          }`}
                          title={isReadOnly ? "Archived sheet (read-only)" : isPlaced ? "Already on sheet (drag to move or reassign)" : `Click to place in Line ${selectedTargetLine} or drag to any row`}
                        >
                          <span className={`font-semibold ${data.injuredPlayerIds?.includes(p.id) ? "line-through text-rose-500" : ""}`}>
                            {p.display_name ?? p.id}
                          </span>
                          {p.gender === "FMP" && <span className="inline-block w-2 h-2 rounded-full bg-pink-500 shrink-0" />}
                          {p.gender === "MMP" && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                          {/* Bench injury toggle button */}
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={(e) => {
                              e.stopPropagation()
                              togglePlayerInjured(p.id)
                            }}
                            title={data.injuredPlayerIds?.includes(p.id) ? "Marked out/injured. Click to restore" : "Mark player out/injured"}
                            className="ml-1 text-[10px] px-1 rounded hover:bg-rose-500/20 text-muted-foreground hover:text-rose-600"
                          >
                            {data.injuredPlayerIds?.includes(p.id) ? "⛔" : "⚠️"}
                          </button>
                          {isPlaced && <span className="text-[10px] text-emerald-600 font-bold ml-0.5">✓</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Preset Manager Panel ──────────────────────────────────── */}
            {showPresetManager && !isReadOnly && (
              <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/5 print:hidden space-y-3">
                <div className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  ⚡ Line Presets
                </div>

                {/* Existing presets */}
                {(data.linePresets ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No presets yet. Save a lineup below to create one.</p>
                ) : (
                  <div className="space-y-1.5">
                    {(data.linePresets ?? []).map((preset) => (
                      <div key={preset.id} className="flex items-center gap-2 bg-card border border-border rounded-md px-2.5 py-1.5">
                        {renamingPresetId === preset.id ? (
                          <>
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && renameValue.trim()) {
                                  saveData({ ...data, linePresets: (data.linePresets ?? []).map((p) => p.id === preset.id ? { ...p, name: renameValue.trim() } : p) })
                                  setRenamingPresetId(null)
                                } else if (e.key === "Escape") {
                                  setRenamingPresetId(null)
                                }
                              }}
                              className="flex-1 border border-input rounded px-1.5 py-0.5 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (renameValue.trim()) {
                                  saveData({ ...data, linePresets: (data.linePresets ?? []).map((p) => p.id === preset.id ? { ...p, name: renameValue.trim() } : p) })
                                }
                                setRenamingPresetId(null)
                              }}
                              className="text-xs text-emerald-600 font-bold hover:text-emerald-700"
                            >Save</button>
                            <button type="button" onClick={() => setRenamingPresetId(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-xs font-semibold text-foreground">{preset.name}</span>
                            <span className="text-[10px] text-muted-foreground">{preset.playerIds.length} players</span>
                            <button
                              type="button"
                              onClick={() => { setRenamingPresetId(preset.id); setRenameValue(preset.name) }}
                              className="text-xs text-muted-foreground hover:text-foreground px-1"
                              title="Rename preset"
                            >✏️</button>
                            <button
                              type="button"
                              onClick={() => saveData({ ...data, linePresets: (data.linePresets ?? []).filter((p) => p.id !== preset.id) })}
                              className="text-xs text-rose-500 hover:text-rose-700 px-1 font-bold"
                              title="Delete preset"
                            >✕</button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Create new preset */}
                <div className="border-t border-amber-500/20 pt-2.5 space-y-2">
                  <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">New Preset</div>

                  {/* Name input */}
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="e.g. Power O"
                    className="w-full border border-input rounded-md px-2 py-1 text-xs bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />

                  {/* Player picker */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        Select players ({newPresetPlayerIds.length}/7)
                      </span>
                      <div className="flex gap-2">
                        {gameMode && (displayData.points[selectedLivePoint]?.playerIds ?? []).length > 0 && (
                          <button
                            type="button"
                            onClick={() => setNewPresetPlayerIds((displayData.points[selectedLivePoint]?.playerIds ?? []).slice(0, 7))}
                            className="text-[11px] text-amber-600 hover:text-amber-800 font-medium"
                          >
                            Use current point
                          </button>
                        )}
                        {newPresetPlayerIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setNewPresetPlayerIds([])}
                            className="text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {teamPlayers.map((p) => {
                        const isSelected = newPresetPlayerIds.includes(p.id)
                        const atMax = newPresetPlayerIds.length >= 7
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={!isSelected && atMax}
                            onClick={() => {
                              setNewPresetPlayerIds((prev) =>
                                prev.includes(p.id)
                                  ? prev.filter((id) => id !== p.id)
                                  : prev.length < 7 ? [...prev, p.id] : prev
                              )
                            }}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                              isSelected
                                ? "bg-amber-600 text-white border-amber-500 ring-1 ring-amber-400"
                                : "bg-card border-border text-foreground hover:bg-amber-500/10 hover:border-amber-400"
                            }`}
                          >
                            {p.gender === "FMP" && <span className="w-1.5 h-1.5 rounded-full bg-pink-300 shrink-0" />}
                            {p.gender === "MMP" && <span className="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0" />}
                            {p.display_name}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Save button */}
                  <button
                    type="button"
                    disabled={!newPresetName.trim() || newPresetPlayerIds.length === 0}
                    onClick={() => {
                      saveData({ ...data, linePresets: [...(data.linePresets ?? []), { id: Math.random().toString(36).slice(2, 9), name: newPresetName.trim(), playerIds: newPresetPlayerIds }] })
                      setNewPresetName("")
                      setNewPresetPlayerIds([])
                    }}
                    className="w-full px-3 py-1.5 rounded-md text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Save Preset ({newPresetPlayerIds.length} players)
                  </button>
                </div>
              </div>
            )}

            {/* ── Divider Helper Banner (when divider edit mode is active) ── */}
            {showDividerControls && !gameMode && (
              <div className="p-2.5 rounded-lg border border-primary/30 bg-primary/5 print:hidden flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-primary">Line Options:</span> Select a preset, or click &quot;+ Split Line&quot; between rows below:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dividerPresets.map((preset) => {
                    const isActive = dividers.length === preset.dividers.length &&
                      preset.dividers.every((d, i) => dividers[i] === d)
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => saveData({ ...displayData, lineDividers: preset.dividers })}
                        className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border bg-background hover:bg-accent text-foreground"
                        }`}
                      >
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Print Header ─────────────────────────────────────────── */}
            <div className="sheet-header-print items-center justify-between border-b-2 border-black pb-1 mb-1">
              <div>
                <span className="font-bold text-sm uppercase tracking-wide">
                  {sheetTitle || `${config.formatLabel} Game Sheet`}
                </span>
                {tournamentDate && <span className="font-normal ml-2 text-xs">({tournamentDate})</span>}
              </div>
              <div className="text-xs">
                vs <span className="font-bold border-b border-black inline-block min-w-[120px] text-center">{opponentName || ""}</span>
                <span className="ml-4">Field: <span className="font-bold border-b border-black inline-block min-w-[50px] text-center">{fieldName || ""}</span></span>
              </div>
            </div>

            {/* ── Main 24-Row Grid Table ─────────────────────────────────── */}
            <div className="print:hidden">
              <button
                type="button"
                onClick={() => setIsGridCollapsed((c) => !c)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-muted/70 transition-colors text-sm font-semibold text-foreground"
              >
                <span className="flex items-center gap-2">
                  <span>{isGridCollapsed ? "▶" : "▼"}</span>
                  <span>📋 Roster Grid</span>
                  {isGridCollapsed && (
                    <span className="text-xs font-normal text-muted-foreground">
                      ({slots.filter(Boolean).length} players assigned · {displayData.points.length} points)
                    </span>
                  )}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {isGridCollapsed ? "Show" : "Hide"}
                </span>
              </button>
            </div>
            <div className={`sheet-scroll-container overflow-x-auto rounded-lg border border-border bg-card shadow-sm ${isGridCollapsed ? "hidden print:block" : ""}`}>
              <table className="sheet-table border-collapse text-sm w-full">
                <thead>
                  <tr className="bg-muted/80 border-b border-border">
                    <th className="roster-cell w-7 text-center text-xs text-muted-foreground font-semibold">#</th>
                    <th className="roster-cell w-9 text-center text-xs text-muted-foreground font-semibold">No</th>
                    <th className="roster-cell text-xs text-muted-foreground font-semibold text-left min-w-[130px] pl-2">Player</th>
                    <th className="roster-cell w-10 text-xs text-muted-foreground font-semibold text-center">Pos</th>
                    <th className="roster-cell w-8 text-center text-xs text-muted-foreground font-semibold print:hidden"></th>
                    <th className="roster-cell w-10 text-center text-xs font-bold text-primary border-r border-border" title="Total Points Played">
                      Pts
                    </th>
                    {displayData.points.map((pt) => (
                      <th
                        key={pt.pointNumber}
                        className="point-cell text-[11px] text-muted-foreground font-semibold text-center border-l border-border"
                      >
                        {pt.pointNumber}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: totalSlots }, (_, slotIndex) => {
                    const rowNumber = slotIndex + 1
                    const player = slots[slotIndex]
                    const isDividerBefore = dividers.includes(slotIndex)
                    const isFirstRow = slotIndex === 0
                    const currentLine = getLineNumber(slotIndex)
                    const isDragOver = dragOverIndex === slotIndex
                    const pointsPlayed = getPlayerPointsPlayed(player?.playerId)

                    return (
                      <React.Fragment key={slotIndex}>
                        {/* Divider Bar - Drop zone for whole line */}
                        {(isFirstRow || isDividerBefore) && (() => {
                          const startIdx = slotIndex
                          const nextDiv = sortedDividers.find((d) => d > slotIndex) ?? totalSlots
                          const endIdx = nextDiv
                          return (
                            <tr
                              onDragOver={(e) => {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = "move"
                              }}
                              onDrop={(e) => handleDropOnLineHeader(e, currentLine, startIdx, endIdx)}
                              className="border-t-2 border-primary/40 bg-muted/30 hover:bg-primary/10 transition-colors cursor-pointer"
                              title={`Drag a player here to place in Line ${currentLine}`}
                            >
                              <td
                                colSpan={6 + displayData.points.length}
                                className="roster-cell py-0.5 text-[11px] font-bold text-primary/80 pl-2 select-none print:py-0 print:text-[8pt]"
                              >
                                <div className="flex items-center justify-between pr-2">
                                  <span>Line {currentLine} <span className="text-[10px] font-normal text-muted-foreground print:hidden">(drop player here to add to line)</span></span>
                                  {showDividerControls && slotIndex > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => toggleDividerAt(slotIndex)}
                                      className="text-[10px] text-destructive hover:underline print:hidden"
                                    >
                                      ✕ Remove split
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })()}

                        {/* Interactive Slot Row */}
                        <tr
                          draggable={!isReadOnly && player !== null}
                          onDragStart={(e) => !isReadOnly && player && handleDragStartFromSlot(e, slotIndex)}
                          onDragOver={(e) => !isReadOnly && handleDragOverSlot(e, slotIndex)}
                          onDrop={(e) => !isReadOnly && handleDropOnSlot(e, slotIndex)}
                          onDragEnd={handleDragEnd}
                          className={`transition-colors border-b border-border/60 ${
                            isDragOver
                              ? "bg-primary/20"
                              : player
                              ? "hover:bg-muted/40"
                              : "bg-muted/5 hover:bg-muted/20"
                          }`}
                        >
                          {/* Row Number */}
                          <td className="roster-cell w-7 text-center text-xs text-muted-foreground font-mono select-none">
                            {rowNumber}
                          </td>

                          {/* Jersey Number */}
                          <td className="roster-cell w-9 text-center text-xs text-muted-foreground font-mono">
                            {player?.jerseyNumber != null ? `#${player.jerseyNumber}` : ""}
                          </td>

                          {/* Player Name / Drop Zone */}
                          <td className="roster-cell font-medium text-foreground text-sm truncate max-w-[140px] pl-2">
                            {player ? (
                              <span className="flex items-center justify-between pr-1">
                                <span className={isReadOnly ? "font-medium" : "cursor-grab active:cursor-grabbing font-medium"}>
                                  {player.displayName}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50 text-xs italic">
                                — empty slot —
                              </span>
                            )}
                          </td>

                          {/* Position */}
                          <td className="roster-cell w-10">
                            <input
                              type="text"
                              maxLength={3}
                              value={player?.position ? abbreviatePosition(player.position) : ""}
                              onChange={(e) => handlePositionChange(slotIndex, abbreviatePosition(e.target.value))}
                              disabled={isReadOnly || !player}
                              className="w-full bg-transparent border-0 border-b border-border/40 text-xs text-center font-medium text-foreground focus:outline-none focus:border-primary disabled:border-transparent print:border-0 uppercase"
                              placeholder=""
                            />
                          </td>

                          {/* Clear Slot / Action Button */}
                          <td className="roster-cell w-8 text-center print:hidden">
                            {isReadOnly ? null : player ? (
                              <button
                                type="button"
                                onClick={() => handleAssignPlayerToSlot(slotIndex, null)}
                                className="text-muted-foreground hover:text-destructive text-xs transition-colors p-0.5"
                                title="Clear slot"
                              >
                                ✕
                              </button>
                            ) : unassignedTeamPlayers.length > 0 ? (
                              <select
                                value=""
                                onChange={(e) => {
                                  const selected = teamPlayers.find((p) => p.id === e.target.value)
                                  if (selected) handleAssignPlayerToSlot(slotIndex, selected)
                                }}
                                className="text-[10px] bg-transparent text-muted-foreground hover:text-foreground cursor-pointer border border-border/50 rounded px-0.5"
                                title="Assign player"
                              >
                                <option value="">+ Add</option>
                                {unassignedTeamPlayers.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.jersey_number != null ? `#${p.jersey_number} ` : ""}{p.display_name ?? p.id}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </td>

                          {/* Player Point Sum Column */}
                          <td className="roster-cell w-10 text-center font-bold text-xs text-primary border-r border-border bg-primary/5">
                            {player ? pointsPlayed : ""}
                          </td>

                          {/* Point Checkboxes */}
                          {displayData.points.map((pt, ptIdx) => {
                            const isChecked = player ? pt.playerIds.includes(player.playerId) : false
                            return (
                              <td
                                key={ptIdx}
                                className={`point-cell text-center border-l border-border/70 ${isReadOnly ? "cursor-not-allowed" : "cursor-pointer"}`}
                                onClick={() => {
                                  if (!isReadOnly && player) togglePlayerPoint(player.playerId, ptIdx)
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => !isReadOnly && player && togglePlayerPoint(player.playerId, ptIdx)}
                                  disabled={isReadOnly || !player}
                                  className={`point-checkbox w-3.5 h-3.5 rounded accent-primary ${isReadOnly ? "cursor-not-allowed opacity-80" : "cursor-pointer disabled:opacity-20"}`}
                                />
                              </td>
                            )
                          })}
                        </tr>

                        {/* Divider toggle helper row in edit mode */}
                        {showDividerControls && slotIndex < totalSlots - 1 && !dividers.includes(slotIndex + 1) && (
                          <tr className="print:hidden">
                            <td
                              colSpan={6 + displayData.points.length}
                              className="p-0 border-y border-dashed border-primary/30 text-center bg-primary/5 hover:bg-primary/10 cursor-pointer transition-colors"
                              onClick={() => toggleDividerAt(slotIndex + 1)}
                            >
                              <span className="text-[10px] font-semibold text-primary/70 py-0.5 inline-block">
                                + Split Line after row {rowNumber}
                              </span>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}

                  {/* ── Footer Tracking Rows ──────────────────────────────── */}

                  {/* Hold Row */}
                  <tr className="border-t-2 border-border bg-emerald-500/5">
                    <td className="roster-cell text-center text-xs font-bold text-emerald-600">H</td>
                    <td className="roster-cell" />
                    <td colSpan={3} className="roster-cell text-xs font-semibold text-emerald-700 dark:text-emerald-400 pl-2">
                      Hold (Us)
                    </td>
                    <td className="roster-cell border-r border-border bg-emerald-500/10 text-center text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {ourHoldsCount}
                    </td>
                    {displayData.points.map((pt, ptIdx) => (
                      <td key={ptIdx} className="point-cell text-center border-l border-border">
                        <input
                          type="checkbox"
                          checked={pt.isCleanHold}
                          disabled={isReadOnly}
                          onChange={() => !isReadOnly && toggleCleanHold(ptIdx)}
                          className={`point-checkbox w-3.5 h-3.5 rounded accent-emerald-600 ${isReadOnly ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
                        />
                      </td>
                    ))}
                  </tr>

                  {/* Break Row */}
                  <tr className="border-t border-border bg-blue-500/5">
                    <td className="roster-cell text-center text-xs font-bold text-blue-600">B</td>
                    <td className="roster-cell" />
                    <td colSpan={3} className="roster-cell text-xs font-semibold text-blue-700 dark:text-blue-400 pl-2">
                      Break (Us)
                    </td>
                    <td className="roster-cell border-r border-border bg-blue-500/10 text-center text-xs font-bold text-blue-700 dark:text-blue-400">
                      {ourBreaksCount}
                    </td>
                    {displayData.points.map((pt, ptIdx) => (
                      <td key={ptIdx} className="point-cell text-center border-l border-border">
                        <input
                          type="checkbox"
                          checked={pt.isCleanBreak}
                          disabled={isReadOnly}
                          onChange={() => !isReadOnly && toggleCleanBreak(ptIdx)}
                          className={`point-checkbox w-3.5 h-3.5 rounded accent-blue-600 ${isReadOnly ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
                        />
                      </td>
                    ))}
                  </tr>

                  {/* Ignite Score Row */}
                  <tr className="border-t border-border bg-amber-500/5">
                    <td className="roster-cell text-center text-xs font-bold text-amber-600">IG</td>
                    <td className="roster-cell" />
                    <td colSpan={3} className="roster-cell text-xs font-semibold text-amber-700 dark:text-amber-400 pl-2">
                      {teamName} Score
                    </td>
                    <td className="roster-cell border-r border-border bg-amber-500/10 text-center text-xs font-bold text-amber-700 dark:text-amber-400">
                      {totalOurScore}
                    </td>
                    {displayData.points.map((pt, ptIdx) => {
                      const isScored = pt.scorer === "us"
                      const currentTotal = ourRunningScores[ptIdx].total
                      return (
                        <td
                          key={ptIdx}
                          className={`point-cell text-center border-l border-border select-none ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
                          onClick={() => !isReadOnly && toggleScorer(ptIdx, "us")}
                          title={isReadOnly ? "" : "Click to toggle Ignite score for this point"}
                        >
                          <div className="print-hide-val flex items-center justify-center font-bold text-[11px] text-amber-700 dark:text-amber-400">
                            {isScored ? currentTotal : "—"}
                          </div>
                          <div className="print-show-box print-blank-box" />
                        </td>
                      )
                    })}
                  </tr>

                  {/* Opponent Score Row */}
                  <tr className="border-t border-border bg-rose-500/5">
                    <td className="roster-cell text-center text-xs font-bold text-rose-600">OP</td>
                    <td className="roster-cell" />
                    <td colSpan={3} className="roster-cell text-xs font-semibold text-rose-700 dark:text-rose-400 pl-2">
                      {opponentName ? `${opponentName} Score` : "Opponent Score"}
                    </td>
                    <td className="roster-cell border-r border-border bg-rose-500/10 text-center text-xs font-bold text-rose-700 dark:text-rose-400">
                      {totalTheirScore}
                    </td>
                    {displayData.points.map((pt, ptIdx) => {
                      const isScored = pt.scorer === "them"
                      const currentTotal = theirRunningScores[ptIdx].total
                      return (
                        <td
                          key={ptIdx}
                          className={`point-cell text-center border-l border-border select-none ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
                          onClick={() => !isReadOnly && toggleScorer(ptIdx, "them")}
                          title={isReadOnly ? "" : "Click to toggle Opponent score for this point"}
                        >
                          <div className="print-hide-val flex items-center justify-center font-bold text-[11px] text-rose-700 dark:text-rose-400">
                            {isScored ? currentTotal : "—"}
                          </div>
                          <div className="print-show-box print-blank-box" />
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Bottom Tracking Panels (1st & 2nd Half Timeouts, Totals, Notes) ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 paper-bottom-grid">
              {/* Timeout Tracking Boxes - 1st & 2nd Half (2 per each) */}
              <div className="p-3 rounded-lg border border-border bg-card space-y-2">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Timeouts (1st Half / 2nd Half)
                </div>
                <div className="space-y-2 text-xs">
                  {/* Ignite Timeouts */}
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{teamName}:</span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">1st:</span>
                        <div className="flex gap-1">
                          {[0, 1].map((i) => (
                            <button
                              key={`our-h1-${i}`}
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => !isReadOnly && toggleHalfTimeout("our", "h1", i)}
                              className={`w-8 h-8 rounded border flex items-center justify-center font-bold text-xs transition-colors disabled:cursor-not-allowed ${
                                                i < ourH1
                                                  ? "bg-primary text-primary-foreground border-primary"
                                                  : "bg-background border-border hover:border-primary/50 text-muted-foreground"
                                              }`}
                            >
                              <span className="print-hide-val">{i < ourH1 ? "✓" : i + 1}</span>
                              <span className="print-show-box"></span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">2nd:</span>
                        <div className="flex gap-1">
                          {[0, 1].map((i) => (
                            <button
                              key={`our-h2-${i}`}
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => !isReadOnly && toggleHalfTimeout("our", "h2", i)}
                              className={`w-8 h-8 rounded border flex items-center justify-center font-bold text-xs transition-colors disabled:cursor-not-allowed ${
                                                i < ourH2
                                                  ? "bg-primary text-primary-foreground border-primary"
                                                  : "bg-background border-border hover:border-primary/50 text-muted-foreground"
                                              }`}
                            >
                              <span className="print-hide-val">{i < ourH2 ? "✓" : i + 1}</span>
                              <span className="print-show-box"></span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Opponent Timeouts */}
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{opponentName || "Opponent"}:</span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">1st:</span>
                        <div className="flex gap-1">
                          {[0, 1].map((i) => (
                            <button
                              key={`their-h1-${i}`}
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => !isReadOnly && toggleHalfTimeout("their", "h1", i)}
                              className={`w-8 h-8 rounded border flex items-center justify-center font-bold text-xs transition-colors disabled:cursor-not-allowed ${
                                                i < theirH1
                                                  ? "bg-muted-foreground text-background border-muted-foreground"
                                                  : "bg-background border-border hover:border-foreground/50 text-muted-foreground"
                                              }`}
                            >
                              <span className="print-hide-val">{i < theirH1 ? "✓" : i + 1}</span>
                              <span className="print-show-box"></span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">2nd:</span>
                        <div className="flex gap-1">
                          {[0, 1].map((i) => (
                            <button
                              key={`their-h2-${i}`}
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => !isReadOnly && toggleHalfTimeout("their", "h2", i)}
                              className={`w-8 h-8 rounded border flex items-center justify-center font-bold text-xs transition-colors disabled:cursor-not-allowed ${
                                                i < theirH2
                                                  ? "bg-muted-foreground text-background border-muted-foreground"
                                                  : "bg-background border-border hover:border-foreground/50 text-muted-foreground"
                                              }`}
                            >
                              <span className="print-hide-val">{i < theirH2 ? "✓" : i + 1}</span>
                              <span className="print-show-box"></span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Game Stats & Summary */}
              <div className="p-3 rounded-lg border border-border bg-card space-y-2">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Score & Point Stats
                </div>
                {/* On-screen view: calculated totals */}
                <div className="print:hidden space-y-2">
                  <div className="grid grid-cols-2 gap-1.5 text-center">
                    <div className="p-1.5 rounded border border-border/60 bg-muted/20">
                      <div className="text-[10px] text-muted-foreground">{teamName} Score</div>
                      <div className="text-base font-bold text-amber-600">{totalOurScore}</div>
                      <div className="text-[10px] font-medium flex items-center justify-center gap-1 text-muted-foreground">
                        <span>Holds: <strong className="text-emerald-600">{ourHoldsCount}</strong></span>
                        <span>·</span>
                        <span>Breaks: <strong className="text-blue-600">{ourBreaksCount}</strong></span>
                      </div>
                    </div>
                    <div className="p-1.5 rounded border border-border/60 bg-muted/20">
                      <div className="text-[10px] text-muted-foreground">{opponentName ? opponentName.slice(0, 10) : "Opponent"} Score</div>
                      <div className="text-base font-bold text-rose-600">{totalTheirScore}</div>
                      <div className="text-[10px] font-medium flex items-center justify-center gap-1 text-muted-foreground">
                        <span>Holds: <strong className="text-rose-600">{theirHoldsCount}</strong></span>
                        <span>·</span>
                        <span>Breaks: <strong className="text-purple-600">{theirBreaksCount}</strong></span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
                    <div className="p-1 rounded border border-border/50 bg-emerald-500/10">
                      <div className="text-muted-foreground">Us Hold</div>
                      <div className="font-bold text-emerald-600">{ourHoldsCount}</div>
                    </div>
                    <div className="p-1 rounded border border-border/50 bg-blue-500/10">
                      <div className="text-muted-foreground">Us Break</div>
                      <div className="font-bold text-blue-600">{ourBreaksCount}</div>
                    </div>
                    <div className="p-1 rounded border border-border/50 bg-rose-500/10">
                      <div className="text-muted-foreground">Opp Hold</div>
                      <div className="font-bold text-rose-600">{theirHoldsCount}</div>
                    </div>
                    <div className="p-1 rounded border border-border/50 bg-purple-500/10">
                      <div className="text-muted-foreground">Opp Break</div>
                      <div className="font-bold text-purple-600">{theirBreaksCount}</div>
                    </div>
                  </div>
                </div>

                {/* Print view: fill-in blank boxes */}
                <div className="hidden print:grid grid-cols-6 gap-1 text-center">
                  <div className="p-1 rounded border border-black/40">
                    <div className="text-[6.5pt] font-semibold">{teamName}</div>
                    <div className="h-3 border-b border-black/30 mt-0.5" />
                  </div>
                  <div className="p-1 rounded border border-black/40">
                    <div className="text-[6.5pt] font-semibold">{opponentName ? opponentName.slice(0, 7) : "Opp"}</div>
                    <div className="h-3 border-b border-black/30 mt-0.5" />
                  </div>
                  <div className="p-1 rounded border border-black/40">
                    <div className="text-[6.5pt] font-semibold">Us Hold</div>
                    <div className="h-3 border-b border-black/30 mt-0.5" />
                  </div>
                  <div className="p-1 rounded border border-black/40">
                    <div className="text-[6.5pt] font-semibold">Us Break</div>
                    <div className="h-3 border-b border-black/30 mt-0.5" />
                  </div>
                  <div className="p-1 rounded border border-black/40">
                    <div className="text-[6.5pt] font-semibold">Opp Hold</div>
                    <div className="h-3 border-b border-black/30 mt-0.5" />
                  </div>
                  <div className="p-1 rounded border border-black/40">
                    <div className="text-[6.5pt] font-semibold">Opp Break</div>
                    <div className="h-3 border-b border-black/30 mt-0.5" />
                  </div>
                </div>
              </div>

              {/* Notes / Mark Box for Paper Printout */}
              <div className="p-3 rounded-lg border border-border bg-card space-y-1">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Game Notes & Marks
                </div>
                <textarea
                  rows={2}
                  placeholder="Wind conditions, match-up notes, key marks..."
                  className="w-full text-xs p-1.5 rounded border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60 resize-none print:hidden"
                />
                <div className="hidden print:block w-full h-10 border border-black/40 rounded p-1" />
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground mb-3">No sheet selected in this view.</p>
            <button
              onClick={handleCreateBlank}
              disabled={createPending}
              className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {createPending ? "Creating…" : "+ New Blank Sheet"}
            </button>
          </div>
        )}
      </div>

      {/* Post-Game Statistics & Summary Modal */}
      {showSummaryModal && (
        <GameSummaryModal
          isOpen={showSummaryModal}
          onClose={() => setShowSummaryModal(false)}
          data={displayData}
          opponentName={opponentName}
          teamName={teamName}
          field={fieldName}
          allPlayers={teamPlayers}
        />
      )}
    </>
  )
}












