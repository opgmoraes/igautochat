import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshLongToken } from "@/lib/instagram";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const db = supabaseAdmin();
  const { data: config } = await db.from("config").select("*").eq("id", 1).single();
  if (!config?.access_token) {
    return NextResponse.json({ ok: false, reason: "sem token" });
  }

  const refreshed = await refreshLongToken(config.access_token);
  await db
    .from("config")
    .update({
      access_token: refreshed.access_token,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("id", 1);

  return NextResponse.json({ ok: true });
}
