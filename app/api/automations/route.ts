import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");

  const db = supabaseAdmin();
  let query = db.from("automations").select("*").order("created_at", { ascending: false });
  if (accountId) query = query.eq("account_id", accountId);
  const { data } = await query;
  return NextResponse.json({ automations: data || [] });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  if (!body.account_id) {
    return NextResponse.json({ error: "Selecione a conta do Instagram" }, { status: 400 });
  }
  const db = supabaseAdmin();

  const keywords = String(body.keywords || "")
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);

  const publicReplies = String(body.public_replies || "")
    .split("\n")
    .map((k: string) => k.trim())
    .filter(Boolean);

  // steps vem do formulário como um array já pronto: [{type:'message',...}, ..., {type:'link',...}]
  const steps = Array.isArray(body.steps) ? body.steps : [];

  const { data: auto, error } = await db
    .from("automations")
    .insert({
      name: body.name || "Automação",
      account_id: body.account_id,
      active: true,
      trigger_comment: !!body.trigger_comment,
      trigger_story_reply: !!body.trigger_story_reply,
      trigger_dm: !!body.trigger_dm,
      keywords,
      match_type: body.match_type || "contains",
      target_media_id: body.target_media_id || null,
      target_mode: body.target_mode || "any",
      target_media_thumb: body.target_media_thumb || null,
      public_replies: publicReplies,
      steps,
      reminder_text: body.reminder_text || null,
      reminder_delay_minutes: Number(body.reminder_delay_minutes || 60),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ automation: auto });
}
