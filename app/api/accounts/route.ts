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

// Remove uma conta conectada. As automações dela NÃO são apagadas: ficam sem conta
// e desativadas, para não perder a configuração se você reconectar a mesma conta depois.
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const db = supabaseAdmin();
  await db.from("automations").update({ account_id: null, active: false }).eq("account_id", id);

  const { error } = await db.from("accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
