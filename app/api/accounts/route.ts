import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const db = supabaseAdmin();
  const { data } = await db
    .from("accounts")
    .select("id, ig_user_id, ig_username, profile_picture_url, token_expires_at, connected_at")
    .order("connected_at", { ascending: true });
  return NextResponse.json({ accounts: data || [] });
}

// Desconecta uma conta (remove o token). As automações dela também são
// removidas junto (on delete cascade no schema), então avise o usuário antes.
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db.from("accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
