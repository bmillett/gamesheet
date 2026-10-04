// ============================================================
// 4s Gamesheet App — Core Types
// ============================================================

export interface Team {
  id: string
  name: string
  players_per_side: number
  roster_size: number
  created_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  email?: string
  created_at: string
}

export interface RosterPlayer {
  id: string
  team_id: string
  display_name: string
  jersey_number: number | null
  position: string
  gender: string          // "FMP" | "MMP" | ""
  is_active: boolean
  sort_order: number
}

/** Per-player stats recorded within a single point */
export interface PlayerPointStats {
  dBlocks: number
  throwaways: number
  drops: number
}

/** A single player slot in the 12-slot line grid */
export interface GameSheetPlayer {
  playerId: string
  displayName: string
  jerseyNumber: number | null
  position: string
  lineIndex: number   // 0 = Line 1, 1 = Line 2, 2 = Line 3
  slotOrder: number   // position within the grid (0-based, 0-11)
}

/** A named lineup preset (e.g. "Power O", "Power D") */
export interface LinePreset {
  id: string          // short random key, generated client-side
  name: string        // e.g. "Power O", "Power D"
  playerIds: string[] // ordered list of player IDs (typically 7)
}

/** One point column in the sheet */
export interface GameSheetPoint {
  pointNumber: number     // 1-indexed
  playerIds: string[]
  isCleanHold: boolean
  isCleanBreak: boolean
  scorer?: "us" | "them" | null
  goalScorerId?: string
  assistPlayerId?: string
  opponentBlocks?: number
  playerStats?: Record<string, PlayerPointStats>
}

/** The full JSONB blob stored in game_sheets.sheet_data */
export interface GameSheetData {
  players: GameSheetPlayer[]
  points: GameSheetPoint[]
  ourTimeouts: number
  theirTimeouts: number
  ourTimeoutsH1?: number
  ourTimeoutsH2?: number
  theirTimeoutsH1?: number
  theirTimeoutsH2?: number
  lineDividers?: number[]
  isArchived?: boolean
  customTitle?: string
  injuredPlayerIds?: string[]
  startingPossession?: "offense" | "defense"
  startingEnd?: "left" | "right"
  genderRatioEnabled?: boolean
  startingRatio?: "4fmp-3mmp" | "3fmp-4mmp"
  linePresets?: LinePreset[]
  clientUpdatedAt?: number
  version?: number
  totalPoints?: number
  playerNotes?: Record<string, string>
}

export interface GameSheetRow {
  id: string
  team_id: string
  opponent_name: string | null
  tournament_name: string | null
  field: string | null
  game_date: string | null
  sheet_data: GameSheetData
  created_at: string
  updated_at: string
}
