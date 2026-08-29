import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const db = supabaseAdmin();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: sentWeek } = await db
    .from("queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", since7d);

  const { count: failed24h } = await db
    .from("queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since24h);

  const { data: accounts } = await db
    .from("ig_accounts")
    .select("token_expires_at")
    .order("token_expires_at", { ascending: true })
    .limit(1);

  return NextResponse.json({
    sentWeek: sentWeek || 0,
    failed24h: failed24h || 0,
    tokenExpiresAt: accounts?.[0]?.token_expires_at || null,
  });
}
