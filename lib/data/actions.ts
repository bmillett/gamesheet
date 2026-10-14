"use server"

import { createClient } from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { getTeamsForUser } from "@/lib/data/auth"
import type { GameSheetData, RosterPlayer } from "@/types/types"

// -- Auth guard --------------------------------------------------------------

async function assertAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  return { supabase, userId: user.id }
}

// -- Sheet actions -----------------------------------------------------------

const DEFAULT_SHEET_DATA: GameSheetData = {
  players: [],
  points: [],
  ourTimeouts: 0,
  theirTimeouts: 0,
  ourTimeoutsH1: 0,
  ourTimeoutsH2: 0,
  theirTimeoutsH1: 0,
  theirTimeoutsH2: 0,
  lineDividers: [8, 16],
  isArchived: false,
  customTitle: "",
}

export async function createSheetAction(teamId: string) {
  try {
    const { supabase } = await assertAuth()
    const { data, error } = await supabase
      .from("game_sheets")
      .insert({ team_id: teamId, sheet_data: DEFAULT_SHEET_DATA })
      .select("id")
      .single()
    if (error) return { error: error.message }
    revalidatePath("/sheet")
    return { id: data.id }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function updateSheetAction(
  sheetId: string,
  fields: Partial<{
    opponent_name: string
    tournament_name: string
    field: string
    game_date: string
    sheet_data: GameSheetData
  }>
) {
  try {
    const { supabase } = await assertAuth()
    const { error } = await supabase
      .from("game_sheets")
      .update(fields)
      .eq("id", sheetId)
    if (error) return { error: error.message }
    // No revalidatePath — GameSheet manages state optimistically client-side.
    // Revalidating would remount the component and reset gameMode/live view state.
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function deleteSheetAction(sheetId: string) {
  try {
    const { supabase } = await assertAuth()
    const { error } = await supabase
      .from("game_sheets")
      .delete()
      .eq("id", sheetId)
    if (error) return { error: error.message }
    revalidatePath("/sheet")
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function duplicateSheetAction(
  sourceSheetId: string,
  newTitle?: string
) {
  try {
    const { supabase } = await assertAuth()
    const { data: source, error: fetchErr } = await supabase
      .from("game_sheets")
      .select("*")
      .eq("id", sourceSheetId)
      .single()
    if (fetchErr || !source) return { error: fetchErr?.message ?? "Not found" }

    // Duplicate: keep roster+dividers+presets, reset points/scores/archive
    const newData: GameSheetData = {
      ...DEFAULT_SHEET_DATA,
      players: source.sheet_data?.players ?? [],
      lineDividers: source.sheet_data?.lineDividers ?? [8, 16],
      linePresets: source.sheet_data?.linePresets ?? [],
      genderRatioEnabled: source.sheet_data?.genderRatioEnabled ?? false,
      startingRatio: source.sheet_data?.startingRatio,
      customTitle: newTitle ?? "",
    }

    const { data, error } = await supabase
      .from("game_sheets")
      .insert({ team_id: source.team_id, sheet_data: newData })
      .select("id, sheet_data")
      .single()
    if (error) return { error: error.message }
    revalidatePath("/sheet")
    return { id: data.id, sheet_data: data.sheet_data as GameSheetData }
  } catch (e: any) {
    return { error: e.message }
  }
}

// -- Roster actions ----------------------------------------------------------

export async function upsertRosterPlayerAction(
  player: Partial<RosterPlayer> & { team_id: string }
) {
  try {
    const { supabase } = await assertAuth()
    const { data, error } = await supabase
      .from("roster_players")
      .upsert(player, { onConflict: "id" })
      .select("*")
      .single()
    if (error) return { error: error.message }
    revalidatePath("/roster")
    return { player: data as RosterPlayer }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function deleteRosterPlayerAction(playerId: string) {
  try {
    const { supabase } = await assertAuth()
    const { error } = await supabase
      .from("roster_players")
      .delete()
      .eq("id", playerId)
    if (error) return { error: error.message }
    revalidatePath("/roster")
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

// -- Team actions ------------------------------------------------------------

export async function createTeamAction(userId: string, teamName: string, playersPerSide: 4 | 7 = 7) {
  try {
    // Verify the caller is authenticated
    await assertAuth()
    // Use service-role client to bypass RLS during initial team+member creation
    // (the user can't pass is_team_member() check before the member row exists)
    const admin = createAdminClient()
    const rosterSize = playersPerSide === 4 ? 12 : 24
    const { data: team, error: teamErr } = await admin
      .from("teams")
      .insert({ name: teamName, players_per_side: playersPerSide, roster_size: rosterSize })
      .select("*")
      .single()
    if (teamErr) return { error: teamErr.message }

    const { error: memberErr } = await admin
      .from("team_members")
      .insert({ team_id: team.id, user_id: userId })
    if (memberErr) return { error: memberErr.message }

    revalidatePath("/sheet")
    return { team }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function updateTeamNameAction(teamId: string, name: string) {
  try {
    const { supabase } = await assertAuth()
    const { error } = await supabase
      .from("teams")
      .update({ name })
      .eq("id", teamId)
    if (error) return { error: error.message }
    revalidatePath("/sheet")
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function updateTeamFormatAction(teamId: string, playersPerSide: 4 | 7) {
  try {
    const { supabase } = await assertAuth()
    const rosterSize = playersPerSide === 4 ? 12 : 24
    const { error } = await supabase
      .from("teams")
      .update({ players_per_side: playersPerSide, roster_size: rosterSize })
      .eq("id", teamId)
    if (error) return { error: error.message }
    revalidatePath("/", "layout")
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function addCoachAction(teamId: string, email: string, password?: string) {
  try {
    const { userId } = await assertAuth()
    const admin = createAdminClient()

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return { error: "Email is required" }

    // Check if the caller belongs to this team
    const { data: callerMember } = await admin
      .from("team_members")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", userId)
      .single()

    if (!callerMember) return { error: "Unauthorized" }

    // Find if user already exists
    let targetUserId: string | null = null
    const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 100 })
    const matchedUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    )

    if (matchedUser) {
      targetUserId = matchedUser.id
      // Update password if one was supplied
      if (password && password.trim().length >= 6) {
        await admin.auth.admin.updateUserById(targetUserId, { password: password.trim() })
      }
    } else {
      if (!password || password.trim().length < 6) {
        return { error: "Password of at least 6 characters is required for new accounts." }
      }
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password: password.trim(),
        email_confirm: true,
      })
      if (createErr || !newUser.user) {
        return { error: createErr?.message || "Failed to create user account" }
      }
      targetUserId = newUser.user.id
    }

    // Check if user is already a member of this team
    const { data: alreadyMember } = await admin
      .from("team_members")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", targetUserId)
      .maybeSingle()

    if (alreadyMember) {
      return { error: "This coach is already on your team." }
    }

    const { error: insertErr } = await admin
      .from("team_members")
      .insert({ team_id: teamId, user_id: targetUserId })

    if (insertErr) return { error: insertErr.message }

    revalidatePath("/coaches")
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

export async function removeCoachAction(teamId: string, memberId: string) {
  try {
    const { userId } = await assertAuth()
    const admin = createAdminClient()

    // Check if the caller belongs to this team
    const { data: callerMember } = await admin
      .from("team_members")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", userId)
      .single()

    if (!callerMember) return { error: "Unauthorized" }

    // Check that we're not removing the last coach
    const { count } = await admin
      .from("team_members")
      .select("*", { count: "exact", head: true })
      .eq("team_id", teamId)

    if ((count ?? 0) <= 1) {
      return { error: "Cannot remove the only coach on the team." }
    }

    const { error } = await admin
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("team_id", teamId)

    if (error) return { error: error.message }

    revalidatePath("/coaches")
    return { success: true }
  } catch (e: any) {
    return { error: e.message }
  }
}

// -- Team switcher -----------------------------------------------------------

export async function setActiveTeamAction(teamId: string): Promise<{ error?: string }> {
  try {
    const teams = await getTeamsForUser()
    if (!teams.find((t) => t.id === teamId)) {
      return { error: "You are not a member of that team." }
    }
    const cookieStore = await cookies()
    cookieStore.set("activeTeamId", teamId, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    })
    revalidatePath("/", "layout")
    return {}
  } catch (e: any) {
    return { error: e.message }
  }
}
