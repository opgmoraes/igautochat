import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const db = supabaseAdmin();
  const { data } = await db
    .from("queue")
    .select("id, kind, status, created_at, error, contacts(username, ig_scoped_id), automations(name)")
    .order("created_at", { ascending: false })
    .limit(30);

  return NextResponse.json({ items: data || [] });
}
