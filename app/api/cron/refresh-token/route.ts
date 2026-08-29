import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshLongToken } from "@/lib/instagram";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const db = supabaseAdmin();
  const { data: accounts } = await db.from("ig_accounts").select("*");

  let renewed = 0;
  let failed = 0;

  for (const account of accounts || []) {
    if (!account.access_token) continue;
    try {
      const refreshed = await refreshLongToken(account.access_token);
      await db
        .from("ig_accounts")
        .update({
          access_token: refreshed.access_token,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        })
        .eq("id", account.id);
      renewed++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, renewed, failed });
}
