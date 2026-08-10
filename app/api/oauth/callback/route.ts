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
      `${process.env.APP_URL}/dashboard.html?error=${encodeURIComponent(error || "sem_code")}`
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/oauth/callback`;

  try {
    const short = await exchangeCodeForShortToken(code, redirectUri);
    const long = await exchangeForLongToken(short.access_token);
    const profile = await fetchProfile(long.access_token);

    const db = supabaseAdmin();

    // Upsert por ig_user_id: se essa conta já estava conectada, só renova o token.
    // Se é uma conta nova (ex: a segunda), cria uma linha nova em vez de sobrescrever.
    const { data: account, error: dbError } = await db
      .from("ig_accounts")
      .upsert(
        {
          ig_user_id: profile.user_id,
          ig_username: profile.username,
          profile_picture_url: profile.profile_picture_url,
          access_token: long.access_token,
          token_expires_at: new Date(Date.now() + long.expires_in * 1000).toISOString(),
          connected_at: new Date().toISOString(),
          label: profile.username, // pode renomear depois no painel
        },
        { onConflict: "ig_user_id" }
      )
      .select()
      .single();

    if (dbError) throw new Error(dbError.message);

    await subscribeApp(profile.user_id, long.access_token);

    return NextResponse.redirect(`${process.env.APP_URL}/dashboard.html?connected=${account.id}`);
  } catch (e: any) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/dashboard.html?error=${encodeURIComponent(e.message)}`
    );
  }
}
