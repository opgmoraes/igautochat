import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const db = supabaseAdmin();
  const { data } = await db.from("automations").select("*").order("created_at", { ascending: false });
  return NextResponse.json({ automations: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = supabaseAdmin();

  const keywords = String(body.keywords || "")
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);

  const publicReplies = String(body.public_replies || "")
    .split("\n")
    .map((k: string) => k.trim())
    .filter(Boolean);

  const { data: auto, error } = await db
    .from("automations")
    .insert({
      name: body.name || "Automação",
      active: true,
      trigger_comment: !!body.trigger_comment,
      trigger_story_reply: !!body.trigger_story_reply,
      trigger_dm: !!body.trigger_dm,
      keywords,
      match_type: body.match_type || "contains",
      target_media_id: body.target_media_id || null,
      public_replies: publicReplies,
      welcome_message: body.welcome_message || "",
      quick_reply_label: body.quick_reply_label || "Quero!",
      link_label: body.link_label || "Acessar",
      link_url: body.link_url || "",
      reminder_text: body.reminder_text || null,
      reminder_delay_minutes: Number(body.reminder_delay_minutes || 60),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await db.from("followups").insert([
    { automation_id: auto.id, step: 1, kind: "link", delay_minutes: 0 },
    ...(auto.reminder_text
      ? [{ automation_id: auto.id, step: 2, kind: "reminder", delay_minutes: auto.reminder_delay_minutes }]
      : []),
  ]);

  return NextResponse.json({ automation: auto });
}
