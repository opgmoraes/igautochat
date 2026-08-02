import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
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

  const { data: config } = await db
    .from("config")
    .select("token_expires_at")
    .eq("id", 1)
    .single();

  return NextResponse.json({
    sentWeek: sentWeek || 0,
    failed24h: failed24h || 0,
    tokenExpiresAt: config?.token_expires_at || null,
  });
}
