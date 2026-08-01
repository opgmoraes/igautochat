import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  exchangeCodeForShortToken,
  exchangeForLongToken,
  fetchProfile,
  subscribeApp,
} from "@/lib/instagram";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/dashboard?error=${encodeURIComponent(error || "sem_code")}`
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/oauth/callback`;

  try {
    const short = await exchangeCodeForShortToken(code, redirectUri);
    const long = await exchangeForLongToken(short.access_token);
    const profile = await fetchProfile(long.access_token);

    const db = supabaseAdmin();
    await db
      .from("config")
      .update({
        ig_user_id: profile.user_id,
        ig_username: profile.username,
        profile_picture_url: profile.profile_picture_url,
        access_token: long.access_token,
        token_expires_at: new Date(Date.now() + long.expires_in * 1000).toISOString(),
        connected_at: new Date().toISOString(),
      })
      .eq("id", 1);

    // Assina os webhooks de comments/messages para essa conta
    await subscribeApp(profile.user_id, long.access_token);

    return NextResponse.redirect(`${process.env.APP_URL}/dashboard?connected=1`);
  } catch (e: any) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/dashboard?error=${encodeURIComponent(e.message)}`
    );
  }
}
