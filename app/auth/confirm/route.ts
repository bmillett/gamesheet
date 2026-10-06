import { type EmailOtpType } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

/**
 * Landing route after Supabase verifies a recovery/confirmation token.
 *
 * PKCE flow (current default):
 *   Supabase redirects here with ?code=xxx&next=/auth/reset
 *   We exchange the code for a session (which sets the auth cookie),
 *   then forward to `next`.
 *
 * token_hash flow (older / custom templates):
 *   /auth/confirm?token_hash=xxx&type=recovery&next=/auth/reset
 *   We call verifyOtp to exchange the hash, then forward to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = searchParams.get("next") ?? "/auth/reset"

  const supabase = await createClient()

  if (code) {
    // PKCE flow — exchange the code for a session and set the auth cookie
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL("/?error=invalid-reset-link", request.url))
    }
    return NextResponse.redirect(new URL(next, request.url))
  }

  if (token_hash && type) {
    // token_hash flow — exchange the hash for a session
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (error) {
      return NextResponse.redirect(new URL("/?error=invalid-reset-link", request.url))
    }
    return NextResponse.redirect(new URL(next, request.url))
  }

  return NextResponse.redirect(new URL("/?error=invalid-reset-link", request.url))
}
