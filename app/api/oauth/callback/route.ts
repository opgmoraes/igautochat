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
    // upsert por ig_user_id: se essa conta já existia, atualiza o token;
    // se é uma conta nova, cria uma linha nova — assim dá pra ter várias contas conectadas ao mesmo tempo
    const { data: account, error: dbError } = await db
      .from("accounts")
      .upsert(
        {
          ig_user_id: profile.user_id,
          ig_username: profile.username,
          profile_picture_url: profile.profile_picture_url,
          access_token: long.access_token,
          token_expires_at: new Date(Date.now() + long.expires_in * 1000).toISOString(),
          connected_at: new Date().toISOString(),
        },
        { onConflict: "ig_user_id" }
      )
      .select()
      .single();
    if (dbError) throw new Error(dbError.message);

    // Assina os webhooks de comments/messages para essa conta
    await subscribeApp(profile.user_id, long.access_token);

    return NextResponse.redirect(`${process.env.APP_URL}/dashboard.html?connected=${account.id}`);
  } catch (e: any) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/dashboard.html?error=${encodeURIComponent(e.message)}`
    );
  }
}
