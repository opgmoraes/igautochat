import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchMedia } from "@/lib/instagram";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const accountId = req.nextUrl.searchParams.get("account_id");
  if (!accountId) return NextResponse.json({ media: [], error: "conta não informada" });

  const db = supabaseAdmin();
  const { data: account } = await db
    .from("ig_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (!account?.access_token || !account?.ig_user_id) {
    return NextResponse.json({ media: [] });
  }
  try {
    const res = await fetchMedia(account.ig_user_id, account.access_token);
    return NextResponse.json({ media: res.data || [] });
  } catch (e: any) {
    return NextResponse.json({ media: [], error: e.message });
  }
}
