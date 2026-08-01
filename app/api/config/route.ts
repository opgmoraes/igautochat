import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const db = supabaseAdmin();
  const { data } = await db.from("config").select("*").eq("id", 1).single();
  return NextResponse.json({ config: data });
}
