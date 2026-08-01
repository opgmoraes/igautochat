import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchMedia } from "@/lib/instagram";

export async function GET() {
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
