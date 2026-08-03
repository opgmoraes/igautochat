import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const db = supabaseAdmin();
  const { data, error } = await db.from("automations").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ automation: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = supabaseAdmin();

  // Alternar ativo/pausado (o painel manda só { active })
  if (Object.keys(body).length === 1 && "active" in body) {
    await db.from("automations").update({ active: !!body.active }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  // Edição completa (vem do formulário de edição)
  const keywords = String(body.keywords || "")
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);
  const publicReplies = String(body.public_replies || "")
    .split("\n")
    .map((k: string) => k.trim())
    .filter(Boolean);

  const { error } = await db
    .from("automations")
    .update({
      name: body.name || "Automação",
      trigger_comment: !!body.trigger_comment,
      trigger_story_reply: !!body.trigger_story_reply,
      trigger_dm: !!body.trigger_dm,
      keywords,
      match_type: body.match_type || "contains",
      target_media_id: body.target_media_id || null,
      target_mode: body.target_mode || "any",
      target_media_thumb: body.target_media_thumb || null,
      public_replies: publicReplies,
      welcome_message: body.welcome_message || "",
      quick_reply_label: body.quick_reply_label || "Quero!",
      pre_link_message: body.pre_link_message || null,
      pre_link_quick_reply_label: body.pre_link_quick_reply_label || "Já segui!",
      link_label: body.link_label || "Acessar",
      link_url: body.link_url || "",
      reminder_text: body.reminder_text || null,
      reminder_delay_minutes: Number(body.reminder_delay_minutes || 60),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Recria os followups do zero (mais simples que tentar diffar)
  await db.from("followups").delete().eq("automation_id", id);
  await db.from("followups").insert([
    { automation_id: id, step: 1, kind: "link", delay_minutes: 0 },
    ...(body.reminder_text
      ? [
          {
            automation_id: id,
            step: 2,
            kind: "reminder",
            delay_minutes: Number(body.reminder_delay_minutes || 60),
          },
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const db = supabaseAdmin();
  const { error } = await db.from("automations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
