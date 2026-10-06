import { type EmailOtpType } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

/**
 * Landing route after Supabase verifies a recovery/confirmation token.
 *
 * Two flows arrive here:
 *
 * 1. PKCE flow (current default): Supabase verifies the token on their end,
 *    sets a session cookie, then redirects here with just ?next=...
 *    We simply forward to `next`.
 *
 * 2. token_hash flow (older / custom templates):
 *    /auth/confirm?token_hash=xxx&type=recovery&next=/auth/reset
 *    We call verifyOtp to exchange the hash, then forward to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = searchParams.get("next") ?? "/auth/reset"

  if (token_hash && type) {
    // token_hash flow — exchange the hash for a session
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (error) {
      return NextResponse.redirect(new URL("/?error=invalid-reset-link", request.url))
    }
  }

  // PKCE flow: session already set by Supabase — just forward
  return NextResponse.redirect(new URL(next, request.url))
}
