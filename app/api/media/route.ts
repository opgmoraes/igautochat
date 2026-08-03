import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchMedia } from "@/lib/instagram";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: config } = await db.from("config").select("*").eq("id", 1).single();
  if (!config?.access_token || !config?.ig_user_id) {
    return NextResponse.json({ media: [] });
  }
  try {
    const res = await fetchMedia(config.ig_user_id, config.access_token);
    return NextResponse.json({ media: res.data || [] });
  } catch (e: any) {
    return NextResponse.json({ media: [], error: e.message });
  }
}
