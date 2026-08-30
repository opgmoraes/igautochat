import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshLongToken } from "@/lib/instagram";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const db = supabaseAdmin();
  const { data: accounts } = await db.from("accounts").select("*").not("access_token", "is", null);

  let refreshed = 0;
  let failed = 0;
  const errors: { account_id: string; ig_username: string | null; error: string }[] = [];

  // Renova o token de CADA conta conectada, uma de cada vez —
  // uma conta falhando (ex: token já expirado de vez) não impede as outras.
  for (const account of accounts || []) {
    try {
      const result = await refreshLongToken(account.access_token);
      await db
        .from("accounts")
        .update({
          access_token: result.access_token,
          token_expires_at: new Date(Date.now() + result.expires_in * 1000).toISOString(),
        })
        .eq("id", account.id);
      refreshed++;
    } catch (e: any) {
      failed++;
      errors.push({
        account_id: account.id,
        ig_username: account.ig_username,
        error: String(e.message || e).slice(0, 300),
      });
    }
  }

  return NextResponse.json({ ok: true, refreshed, failed, errors });
}
