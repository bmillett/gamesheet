/**
 * lib/offline/db.ts
 *
 * IndexedDB adapter for local-first offline storage of game sheets,
 * rosters, and pending sync mutations.
 */

import type { GameSheetData } from "@/types/types"

const DB_NAME = "gamesheet_offline_db"
const DB_VERSION = 2

export interface LocalGameSheet {
  id: string
  team_id: string
  event_id: string | null
  opponent_name: string | null
  tournament_name: string | null
  field: string | null
  notes: string | null
  sheet_data: GameSheetData
  updated_at: string
  is_local_only?: boolean
  dirty?: boolean
}

export interface PendingSyncAction {
  id: string // Unique client action ID (UUID)
  sheetId: string
  teamId: string
  type: "upsert" | "update" | "create_blank" | "delete"
  payload: Partial<LocalGameSheet> & {
    data?: GameSheetData
    opponentName?: string
    tournamentName?: string
    field?: string
    notes?: string
    isArchived?: boolean
    excludeFromStats?: boolean
  }
  timestamp: number
  retryCount: number
  lastError?: string
}

export interface CachedTeamRoster {
  teamId: string
  players: Array<{ id: string; display_name: string | null; jersey_number: number | null; position: string | null }>
  cachedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"))
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Store for full local game sheets (indexed by id and team_id)
        if (!db.objectStoreNames.contains("game_sheets")) {
          const sheetStore = db.createObjectStore("game_sheets", { keyPath: "id" })
          sheetStore.createIndex("team_id", "team_id", { unique: false })
        }

        // Queue for pending mutations when offline
        if (!db.objectStoreNames.contains("pending_sync_queue")) {
          const queueStore = db.createObjectStore("pending_sync_queue", { keyPath: "id" })
          queueStore.createIndex("timestamp", "timestamp", { unique: false })
          queueStore.createIndex("sheetId", "sheetId", { unique: false })
        }

        // Store for pre-cached team rosters
        if (!db.objectStoreNames.contains("cached_rosters")) {
          db.createObjectStore("cached_rosters", { keyPath: "teamId" })
        }
      }

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  return dbPromise
}

// Request persistent storage so the browser does not evict data under disk pressure
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persist()
      return isPersisted
    } catch {
      return false
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Game Sheets CRUD
// ---------------------------------------------------------------------------

export async function saveLocalSheet(sheet: LocalGameSheet): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("game_sheets", "readwrite")
    const store = tx.objectStore("game_sheets")
    const req = store.put(sheet)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getLocalSheet(id: string): Promise<LocalGameSheet | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("game_sheets", "readonly")
    const store = tx.objectStore("game_sheets")
    const req = store.get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function getAllLocalSheets(teamId?: string): Promise<LocalGameSheet[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("game_sheets", "readonly")
    const store = tx.objectStore("game_sheets")
    
    if (teamId) {
      const index = store.index("team_id")
      const req = index.getAll(teamId)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } else {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    }
  })
}

export async function deleteLocalSheet(id: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("game_sheets", "readwrite")
    const store = tx.objectStore("game_sheets")
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ---------------------------------------------------------------------------
// Pending Sync Queue
// ---------------------------------------------------------------------------

export async function enqueueSyncAction(action: PendingSyncAction): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_sync_queue", "readwrite")
    const store = tx.objectStore("pending_sync_queue")
    const req = store.put(action)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getAllPendingSyncActions(): Promise<PendingSyncAction[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_sync_queue", "readonly")
    const store = tx.objectStore("pending_sync_queue")
    const req = store.getAll()
    req.onsuccess = () => {
      const items = (req.result || []) as PendingSyncAction[]
      items.sort((a, b) => a.timestamp - b.timestamp)
      resolve(items)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function removePendingSyncAction(id: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending_sync_queue", "readwrite")
    const store = tx.objectStore("pending_sync_queue")
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getPendingSyncCount(teamId?: string): Promise<number> {
  const actions = await getAllPendingSyncActions()
  if (!teamId) return actions.length
  return actions.filter((a) => a.teamId === teamId).length
}

// ---------------------------------------------------------------------------
// Cached Rosters
// ---------------------------------------------------------------------------

export async function saveCachedRoster(
  teamId: string,
  players: Array<{ id: string; display_name: string | null; jersey_number: number | null; position: string | null }>
): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cached_rosters", "readwrite")
    const store = tx.objectStore("cached_rosters")
    const req = store.put({ teamId, players, cachedAt: Date.now() })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getCachedRoster(
  teamId: string
): Promise<Array<{ id: string; display_name: string | null; jersey_number: number | null; position: string | null }> | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cached_rosters", "readonly")
    const store = tx.objectStore("cached_rosters")
    const req = store.get(teamId)
    req.onsuccess = () => resolve(req.result ? req.result.players : null)
    req.onerror = () => reject(req.error)
  })
}

