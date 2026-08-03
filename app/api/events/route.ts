import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const db = supabaseAdmin();
  const { data } = await db
    .from("queue")
    .select("id, kind, status, created_at, error, contacts(username, ig_scoped_id), automations(name)")
    .order("created_at", { ascending: false })
    .limit(30);

  return NextResponse.json({ items: data || [] });
}
