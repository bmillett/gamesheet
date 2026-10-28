/**
 * lib/utils/gender-ratio.ts
 *
 * Gender ratio utilities for mixed ultimate frisbee.
 *
 * --- 7v7 ---
 * The ABBAABBAA alternating pattern is period-4:
 *   [A, B, B, A,  A, B, B, A,  ...]
 *   idx: 0  1  2  3  4  5  6  7
 *
 * For point index i:
 *   ratio is A  when  i % 4 === 0 or i % 4 === 3
 *   ratio is B  when  i % 4 === 1 or i % 4 === 2
 *
 * startingRatio determines which gender has 4 on point 0.
 *   "4fmp-3mmp"  →  A = 4 FMP / 3 MMP,  B = 3 FMP / 4 MMP
 *   "3fmp-4mmp"  →  A = 3 FMP / 4 MMP,  B = 4 FMP / 3 MMP
 *
 * --- 4v4 ---
 * Ratio is fixed every point: always 2 FMP / 2 MMP.
 * startingRatio and pointIndex are ignored when playersPerSide === 4.
 */

export type StartingRatio = "4fmp-3mmp" | "3fmp-4mmp"

export interface GenderCount {
  fmp: number
  mmp: number
  unknown: number
}

export interface ExpectedRatio {
  fmp: number
  mmp: number
}

export type RatioStatus = "ok" | "wrong" | "incomplete" | "disabled"

/**
 * Returns the expected FMP/MMP counts for a given point index and starting ratio.
 * For 4v4 (playersPerSide === 4), always returns { fmp: 2, mmp: 2 }.
 */
export function getExpectedRatio(
  pointIndex: number,
  startingRatio: StartingRatio,
  playersPerSide = 7
): ExpectedRatio {
  if (playersPerSide === 4) return { fmp: 2, mmp: 2 }

  const mod = pointIndex % 4
  const isA = mod === 0 || mod === 3

  if (startingRatio === "4fmp-3mmp") {
    return isA ? { fmp: 4, mmp: 3 } : { fmp: 3, mmp: 4 }
  } else {
    return isA ? { fmp: 3, mmp: 4 } : { fmp: 4, mmp: 3 }
  }
}

/**
 * Counts FMP / MMP / unknown among a set of player IDs.
 * allPlayers is any iterable with id + gender fields.
 */
export function countGenders(
  playerIds: string[],
  allPlayers: Array<{ id: string; gender: string }>
): GenderCount {
  const genderMap = new Map(allPlayers.map((p) => [p.id, p.gender]))
  let fmp = 0
  let mmp = 0
  let unknown = 0

  for (const id of playerIds) {
    const g = genderMap.get(id) ?? ""
    if (g === "FMP") fmp++
    else if (g === "MMP") mmp++
    else unknown++
  }

  return { fmp, mmp, unknown }
}

/**
 * Returns the ratio status for a point.
 *   "ok"         — correct ratio and all player slots filled
 *   "wrong"      — all slots filled but wrong gender split
 *   "incomplete" — fewer than playersPerSide players (no error state yet)
 *   "disabled"   — ratio enforcement is off
 */
export function getRatioStatus(
  pointIndex: number,
  startingRatio: StartingRatio,
  playerIds: string[],
  allPlayers: Array<{ id: string; gender: string }>,
  playersPerSide = 7
): RatioStatus {
  if (playerIds.length < playersPerSide) return "incomplete"

  const { fmp, mmp, unknown } = countGenders(playerIds, allPlayers)
  if (unknown > 0) return "wrong" // unknown gender counts as a violation

  const expected = getExpectedRatio(pointIndex, startingRatio, playersPerSide)
  return fmp === expected.fmp && mmp === expected.mmp ? "ok" : "wrong"
}

