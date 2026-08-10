import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = supabaseAdmin();

  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if ("title" in body) update.title = body.title;
  if ("content_body" in body) update.content_body = body.content_body;
  if ("status" in body) update.status = body.status;
  if ("dm_keyword" in body) update.dm_keyword = body.dm_keyword;
  if ("post_date" in body) update.post_date = body.post_date; // pode vir null (tira da data)

  const { error } = await db.from("content_pipeline").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const db = supabaseAdmin();
  const { error } = await db.from("content_pipeline").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
