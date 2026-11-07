import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";
import { validateFlow } from "@/lib/automation";

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
    const { error } = await db.from("automations").update({ active: !!body.active }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // Edição completa (vem do formulário de edição)
  const validation = validateFlow(body);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });
  const keywords = String(body.keywords || "")
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);
  const publicReplies = String(body.public_replies || "")
    .split("\n")
    .map((k: string) => k.trim())
    .filter(Boolean);

  const steps = Array.isArray(body.steps) ? body.steps : [];

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
      steps,
      require_follow: body.require_follow === true,
      followup_steps: body.followup_steps || [],
      reminder_text: body.reminder_text || null,
      reminder_delay_minutes: Number(body.reminder_delay_minutes || 60),
      reminder_link_label: body.reminder_link_label || null,
      reminder_link_url: body.reminder_link_url || null,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireUser(req)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { id } = await params;
  const db = supabaseAdmin();
  const {data:source,error} = await db.from('automations').select('*').eq('id',id).single();
  if (error || !source) return NextResponse.json({error:'Campanha não encontrada'}, {status:404});
  const copy = {...source};
  delete copy.id;
  delete copy.created_at;
  const result = await db.from('automations').insert({...copy,name:`${source.name} (cópia)`,active:false}).select().single();
  if (result.error) return NextResponse.json({error:result.error.message}, {status:400});
  return NextResponse.json({automation:result.data}, {status:201});
}
